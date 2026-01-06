import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { renderQueue } from "../lib/queue.js";
import { config } from "../config.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /admin/stats - получить статистику (защищено секретным ключом)
  fastify.get<{ Querystring: { key?: string } }>(
    "/admin/stats",
    async (request, reply) => {
      const { key } = request.query;

      // Проверка секретного ключа
      if (!key || key !== config.adminSecretKey) {
        return reply.status(401).send({ error: "Invalid admin key" });
      }

      // Текущая дата (начало дня)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Начало недели (понедельник)
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      weekStart.setHours(0, 0, 0, 0);

      // Параллельно выполняем все запросы
      const [
        totalUsers,
        totalSessions,
        todaySessions,
        completedSessions,
        renderingNow,
        failedRenders,
        playerDistribution,
        weeklyStats,
        queueInfo,
      ] = await Promise.all([
        // Уникальные игроки
        prisma.participant.groupBy({
          by: ["tgUserId"],
          _count: true,
        }).then((r) => r.length),

        // Всего сессий
        prisma.session.count(),

        // Сессий сегодня
        prisma.session.count({
          where: { createdAt: { gte: todayStart } },
        }),

        // Завершённых (status = ready)
        prisma.session.count({
          where: { status: "ready" },
        }),

        // Сейчас рендерятся
        prisma.render.count({
          where: { status: "rendering" },
        }),

        // Провалились
        prisma.render.count({
          where: { status: "failed" },
        }),

        // Распределение по количеству игроков
        prisma.session.groupBy({
          by: ["maxPlayers"],
          _count: true,
        }),

        // Статистика по дням за неделю
        prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
          SELECT DATE("createdAt") as date, COUNT(*) as count
          FROM "Session"
          WHERE "createdAt" >= ${weekStart}
          GROUP BY DATE("createdAt")
          ORDER BY date
        `,

        // Очередь рендеров
        renderQueue.getJobCounts(),
      ]);

      // Форматируем распределение игроков
      const players: Record<string, number> = { solo: 0, duo: 0, trio: 0 };
      for (const p of playerDistribution) {
        if (p.maxPlayers === 1) players.solo = p._count;
        if (p.maxPlayers === 2) players.duo = p._count;
        if (p.maxPlayers === 3) players.trio = p._count;
      }

      // Форматируем недельную статистику
      const weekly = weeklyStats.map((row) => ({
        date: String(row.date),
        count: Number(row.count),
      }));

      // Конверсия
      const conversionRate = totalSessions > 0
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;

      return {
        timestamp: new Date().toISOString(),
        users: {
          total: totalUsers,
        },
        sessions: {
          total: totalSessions,
          today: todaySessions,
          completed: completedSessions,
          conversionRate: `${conversionRate}%`,
        },
        renders: {
          rendering: renderingNow,
          failed: failedRenders,
          queue: {
            waiting: queueInfo.waiting,
            active: queueInfo.active,
            delayed: queueInfo.delayed,
          },
        },
        playerDistribution: players,
        weekly,
      };
    }
  );

  // GET /admin/health - расширенная проверка здоровья
  fastify.get<{ Querystring: { key?: string } }>(
    "/admin/health",
    async (request, reply) => {
      const { key } = request.query;

      if (!key || key !== config.adminSecretKey) {
        return reply.status(401).send({ error: "Invalid admin key" });
      }

      const checks: Record<string, string> = {};

      // Database
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = "ok";
      } catch (e) {
        checks.database = `error: ${e}`;
      }

      // Redis (через queue)
      try {
        const counts = await renderQueue.getJobCounts();
        checks.redis = "ok";
        checks.queueJobs = JSON.stringify(counts);
      } catch (e) {
        checks.redis = `error: ${e}`;
      }

      const allOk = Object.values(checks).every((v) => v === "ok" || v.startsWith("{"));

      return {
        status: allOk ? "healthy" : "unhealthy",
        checks,
        timestamp: new Date().toISOString(),
      };
    }
  );

  // GET /admin/sessions - список последних сессий
  fastify.get<{ Querystring: { key?: string; limit?: string } }>(
    "/admin/sessions",
    async (request, reply) => {
      const { key, limit = "20" } = request.query;

      if (!key || key !== config.adminSecretKey) {
        return reply.status(401).send({ error: "Invalid admin key" });
      }

      const sessions = await prisma.session.findMany({
        take: Math.min(parseInt(limit), 100),
        orderBy: { createdAt: "desc" },
        include: {
          participants: {
            select: { displayName: true, roleIndex: true },
          },
          render: {
            select: { status: true },
          },
          _count: {
            select: { takes: true },
          },
        },
      });

      return sessions.map((s) => ({
        id: s.id,
        status: s.status,
        maxPlayers: s.maxPlayers,
        topic: s.topic,
        players: s.participants.map((p) => p.displayName),
        takesCount: s._count.takes,
        renderStatus: s.render?.status || null,
        createdAt: s.createdAt,
      }));
    }
  );
};

