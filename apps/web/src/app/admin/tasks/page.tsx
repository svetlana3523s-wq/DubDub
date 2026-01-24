"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { RU } from "@dubdub/shared";
import type { TaskItem } from "@dubdub/shared";

type Filter = "all" | "active" | "archived";

export default function AdminTasksPage() {
  const router = useRouter();
  const { isReady, initData } = useTelegram();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const isActiveFilter = useMemo(() => {
    if (filter === "active") return true;
    if (filter === "archived") return false;
    return undefined;
  }, [filter]);

  useEffect(() => {
    if (!isReady) return;
    if (!initData) {
      setError(RU.web.admin.scenes.noAccessBody);
      setIsAdmin(false);
      return;
    }

    const checkAdmin = async () => {
      try {
        const result = await api.checkAdmin(initData);
        if (!result.isAdmin) {
          setError(RU.web.admin.scenes.noAccessShort);
          setIsAdmin(false);
          return;
        }
        setIsAdmin(true);
      } catch (err) {
        console.error("Failed to check admin:", err);
        setError(RU.web.admin.scenes.adminCheckError);
        setIsAdmin(false);
      }
    };

    checkAdmin();
  }, [isReady, initData, router]);

  const loadTasks = useCallback(async () => {
    if (!initData || !isAdmin) return;
    setLoading(true);
    setError(null);

    try {
      const result = await api.getTasks(initData, {
        page,
        limit,
        search: search || undefined,
        isActive: isActiveFilter,
      });
      setTasks(result.tasks);
      setTotal(result.total);
    } catch (err: any) {
      console.error("Failed to load tasks:", err);
      setError(err.message || RU.web.admin.tasks.loadError);
    } finally {
      setLoading(false);
    }
  }, [initData, isAdmin, page, limit, search, isActiveFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const setFilterAndReset = (value: Filter) => {
    setFilter(value);
    setPage(1);
  };

  const mapTaskError = (err: any, fallback: string) => {
    const code = err?.code;
    if (code === "TASK_TEXT_TOO_SHORT") return RU.web.admin.tasks.validationTooShort;
    if (code === "TASK_TEXT_TOO_LONG") return RU.web.admin.tasks.validationTooLong;
    if (code === "TASK_DUPLICATE") return RU.web.admin.tasks.duplicateError;
    return err?.message || fallback;
  };

  const handleCreate = async () => {
    if (!initData) return;
    const text = newText.trim();
    if (text.length < 5) {
      setError(RU.web.admin.tasks.validationTooShort);
      return;
    }
    if (text.length > 140) {
      setError(RU.web.admin.tasks.validationTooLong);
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await api.createTask(initData, text);
      setNewText("");
      setPage(1);
      loadTasks();
    } catch (err: any) {
      setError(mapTaskError(err, RU.web.admin.tasks.createError));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (task: TaskItem) => {
    setEditingId(task.id);
    setEditingText(task.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const handleSave = async (task: TaskItem) => {
    if (!initData) return;
    const text = editingText.trim();
    if (text.length < 5) {
      setError(RU.web.admin.tasks.validationTooShort);
      return;
    }
    if (text.length > 140) {
      setError(RU.web.admin.tasks.validationTooLong);
      return;
    }

    setSavingId(task.id);
    setError(null);
    try {
      await api.updateTask(initData, task.id, { text });
      cancelEdit();
      loadTasks();
    } catch (err: any) {
      setError(mapTaskError(err, RU.web.admin.tasks.updateError));
    } finally {
      setSavingId(null);
    }
  };

  const handleToggle = async (task: TaskItem) => {
    if (!initData) return;
    setSavingId(task.id);
    setError(null);
    try {
      await api.updateTask(initData, task.id, { isActive: !task.isActive });
      loadTasks();
    } catch (err: any) {
      setError(err.message || RU.web.admin.tasks.updateError);
    } finally {
      setSavingId(null);
    }
  };

  const handlePrev = () => {
    setPage((p) => Math.max(1, p - 1));
  };

  const handleNext = () => {
    setPage((p) => Math.min(totalPages, p + 1));
  };

  if (isAdmin === false) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">{RU.web.admin.scenes.noAccessTitle}</h1>
          <p className="text-white/70 text-sm">{error || RU.web.admin.scenes.noAccessBody}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 pb-8">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{RU.web.admin.tasks.title}</h1>
              <p className="text-white/50 text-sm">{RU.web.admin.tasks.totalLabel(total)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => router.push("/admin/scenes")}>
                {RU.web.admin.scenes.title}
              </Button>
            </div>
          </div>

          {error && (
            <Card className="border border-red-500/40 text-red-200">{error}</Card>
          )}

          <Card className="space-y-4">
            <div className="text-sm text-white/70">{RU.web.admin.tasks.textLabel}</div>
            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={newText}
                onChange={(event) => setNewText(event.target.value)}
                placeholder={RU.web.admin.tasks.textPlaceholder}
              />
              <Button
                onClick={handleCreate}
                loading={creating}
                className="md:whitespace-nowrap"
              >
                {creating ? RU.web.admin.tasks.creating : RU.web.admin.tasks.createButton}
              </Button>
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="text-sm text-white/70">{RU.web.admin.tasks.searchLabel}</div>
            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={RU.web.admin.tasks.searchPlaceholder}
              />
              <Button variant="secondary" onClick={handleSearch} className="md:whitespace-nowrap">
                {RU.web.admin.tasks.searchButton}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={filter === "all" ? "primary" : "secondary"}
                onClick={() => setFilterAndReset("all")}
              >
                {RU.web.admin.tasks.filterAll}
              </Button>
              <Button
                size="sm"
                variant={filter === "active" ? "primary" : "secondary"}
                onClick={() => setFilterAndReset("active")}
              >
                {RU.web.admin.tasks.filterActive}
              </Button>
              <Button
                size="sm"
                variant={filter === "archived" ? "primary" : "secondary"}
                onClick={() => setFilterAndReset("archived")}
              >
                {RU.web.admin.tasks.filterArchived}
              </Button>
            </div>
          </Card>
        </div>

        {loading ? (
          <Card className="text-center text-white/70">{RU.web.admin.tasks.loading}</Card>
        ) : tasks.length === 0 ? (
          <Card className="text-center space-y-4">
            <div className="text-lg font-semibold">{RU.web.admin.tasks.emptyTitle}</div>
            <div className="text-white/60 text-sm">{RU.web.admin.tasks.emptyButton}</div>
          </Card>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => {
              const isEditing = editingId === task.id;
              const isSaving = savingId === task.id;
              return (
                <Card key={task.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <span>{task.isActive ? RU.web.admin.tasks.statusActive : RU.web.admin.tasks.statusArchived}</span>
                    </div>
                    <div className="flex gap-2">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleSave(task)}
                            loading={isSaving}
                          >
                            {isSaving ? RU.web.admin.tasks.saving : RU.web.admin.tasks.saveButton}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={cancelEdit}>
                            {RU.web.admin.tasks.cancelButton}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => startEdit(task)}>
                            {RU.web.admin.tasks.editButton}
                          </Button>
                          <Button
                            size="sm"
                            variant={task.isActive ? "danger" : "secondary"}
                            onClick={() => handleToggle(task)}
                            loading={isSaving}
                          >
                            {task.isActive ? RU.web.admin.tasks.disableButton : RU.web.admin.tasks.enableButton}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing ? (
                    <Input
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                    />
                  ) : (
                    <div className="text-white text-sm">{task.text}</div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={handlePrev} disabled={page === 1}>
              {RU.web.admin.scenes.prevPage}
            </Button>
            <div className="text-xs text-white/60">
              {page} / {totalPages}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleNext}
              disabled={page === totalPages}
            >
              {RU.web.admin.scenes.nextPage}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
