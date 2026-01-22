export const RU = {
  web: {
    result: {
      sendTimeout: "\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u043d\u043e\u0433\u043e \u0432\u0440\u0435\u043c\u0435\u043d\u0438. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.",
      sendFailed: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0432\u0438\u0434\u0435\u043e. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.",
      sendGenericFailed: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c",
      sendError: "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438",
      renderFailedTitle: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0432\u0438\u0434\u0435\u043e",
      renderFailedSubtitle: "\u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437",
      renderInProgressTitle: "\u0420\u0435\u043d\u0434\u0435\u0440\u0438\u043c \u0432\u0438\u0434\u0435\u043e",
      renderInProgressSubtitle: "\u041f\u043e\u0447\u0442\u0438 \u0433\u043e\u0442\u043e\u0432\u043e...",
      readyTitle: "\u0413\u043e\u0442\u043e\u0432\u043e!",
      readySubtitle: "\u0412\u0430\u0448 \u0434\u0443\u0431\u043b\u044f\u0436 \u0441\u043e\u0431\u0440\u0430\u043d",
      taskLabel: () => `\u{1F4DD} \u0417\u0430\u0434\u0430\u043d\u0438\u0435`,
      waitingConfirmTitle: () => "\u{23F3}",
      waitingConfirmBody:
        "\u0416\u0434\u0451\u043c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0442 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0430...",
      waitingConfirmHint:
        "\u0414\u0440\u0443\u0433\u043e\u0439 \u0438\u0433\u0440\u043e\u043a \u0434\u043e\u043b\u0436\u0435\u043d \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0437\u0430\u043f\u0443\u0441\u043a \u043d\u043e\u0432\u043e\u0439 \u0438\u0433\u0440\u044b",
      sendStatusSent: "\u0412\u0438\u0434\u0435\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0447\u0430\u0442. \u0421\u043a\u043e\u0440\u043e \u043f\u0440\u0438\u0434\u0451\u0442.",
      sendStatusAssumedSent:
        "\u0412\u0438\u0434\u0435\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0447\u0430\u0442. \u041c\u043e\u0436\u0435\u0442 \u043f\u0440\u0438\u0439\u0442\u0438 \u0441 \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u043e\u0439 10\u201330 \u0441\u0435\u043a\u0443\u043d\u0434.",
      sendStatusSending: "\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c \u0432\u0438\u0434\u0435\u043e \u0432 \u0447\u0430\u0442\u2026",
      sendStatusRateLimited: (countdown: number) =>
        `\u0422\u0435\u043b\u0435\u0433\u0440\u0430\u043c \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0438\u043b \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c, \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u043c \u0447\u0435\u0440\u0435\u0437 ${countdown} \u0441\u0435\u043a.`,
      sendStatusFailed: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0432\u0438\u0434\u0435\u043e. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.",
      sendStatusTooLarge: "\u0412\u0438\u0434\u0435\u043e \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0435 \u0434\u043b\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0432 Telegram.",
      showGameId: "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c ID \u0438\u0433\u0440\u044b",
      gameId: (sessionId: string) => `ID \u0438\u0433\u0440\u044b: ${sessionId}`,
      replaySame: () => `\u{1F504} \u0415\u0449\u0451 \u0440\u0430\u0437`,
      replayNew: () => `\u{1F3B2} \u041d\u043e\u0432\u0430\u044f \u0441\u0446\u0435\u043d\u0430`,
      confirmTitleSame: "\u0415\u0449\u0451 \u0440\u0430\u0437",
      confirmTitleNew: "\u041d\u043e\u0432\u0430\u044f \u0441\u0446\u0435\u043d\u0430",
      confirmBody:
        "\u0422\u0435\u043a\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043e \u043d\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0441\u044f. \u0412\u044b \u0443\u0432\u0435\u0440\u0435\u043d\u044b, \u0447\u0442\u043e \u0445\u043e\u0442\u0438\u0442\u0435 \u043d\u0430\u0447\u0430\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u0438\u0433\u0440\u0443?",
      confirmCancel: "\u041e\u0442\u043c\u0435\u043d\u0430",
      confirmOk: "\u041e\u041a",
      replayRequestTitleSame: "\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u0438\u0433\u0440\u0443",
      replayRequestTitleNew: "\u041d\u043e\u0432\u0430\u044f \u0441\u0446\u0435\u043d\u0430",
      replayRequestBody: (
        name: string,
        mode: "newScene" | "sameScene"
      ) =>
        `${name} \u0445\u043e\u0447\u0435\u0442 ${mode === "newScene" ? "\u043d\u0430\u0447\u0430\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u0441\u0446\u0435\u043d\u0443" : "\u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u0441\u0446\u0435\u043d\u0443"}. \u0412\u044b \u0441\u043e\u0433\u043b\u0430\u0441\u043d\u044b?`,
      replayConfirmNo: "\u041d\u0435\u0442",
      replayConfirmYes: "\u0414\u0430, \u043f\u043e\u0435\u0445\u0430430\u043b\u0438!",
      replayConfirmLoading: "...",
      renderFailEmoji: () => "\u{1F622}",
      renderEmoji: () => "\u{1F3A5}",
      readyEmoji: () => "\u{1F389}",
      warningEmoji: () => "\u{26A0}\u{FE0F}",
      replayEmoji: () => "\u{1F3AE}",
    },
    session: {
      skipScene: "\u{23ED} \u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0446\u0435\u043d\u0443",
      skipNotAllowedAfterFirstTake:
        "\u041f\u0440\u043e\u043f\u0443\u0441\u043a \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043e \u043f\u0435\u0440\u0432\u043e\u0439 \u0437\u0430\u043f\u0438\u0441\u0438.",
      skipLimitReached:
        "\u041c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0446\u0435\u043d\u0443 \u0442\u043e\u043b\u044c\u043a\u043e 5 \u0440\u0430\u0437 \u0437\u0430 \u0441\u0435\u0441\u0441\u0438\u044e.",
      skipHostOnly:
        "\u0422\u043e\u043b\u044c\u043a\u043e \u0441\u043e\u0437\u0434\u0430\u0442\u0435\u043b\u044c \u043c\u043e\u0436\u0435\u0442 \u043f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0442\u044c \u0441\u0446\u0435\u043d\u0443.",
      skipFailed:
        "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0446\u0435\u043d\u0443. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.",
    },
  },
  worker: {
    telegramKeyboard: {
      play: "\u{1F3AE} \u0418\u0433\u0440\u0430\u0442\u044c",
      playAgain: "\u{1F504} \u0421\u044b\u0433\u0440\u0430\u0442\u044c \u0435\u0449\u0451",
      mainMenu: "\u{1F3E0} \u0412 \u0433\u043b\u0430\u0432\u043d\u043e\u0435 \u043c\u0435\u043d\u044e",
    },
    sendCaption: (task: string | null | undefined, botUsername: string) =>
      `\u{1F4BD} \u0412\u0430\u0448 \u0434\u0443\u0431\u043b\u044f\u0436 ${task ? `\"${task}\"` : ""}\n\n\u0421\u043e\u0437\u0434\u0430\u043d\u043e \u0432 @${botUsername}`,
    tooLargeError: (fileSizeMB: string) =>
      `\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439 (${fileSizeMB}MB). \u041c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 50MB.`,
  },
  bot: {
    mainMenu: {
      startGame: "\u{1F3AE} Начать игру",
      joinGame: "\u{1F465} Присоединиться к игре",
      suggestEpisode: "\u{1F4A1} Предложить эпизод",
      adminPanel: "\u{1F6E0} Админ-панель",
      cancel: "\u{274C} Отмена",
      cancelPlain: "отмена",
    },
    start: {
      welcome:
        "\u{1F3AE} Добро пожаловать в DubDub! Это игра, где вы озвучиваете сцены из кино и мемов.\n\n" +
        "Выберите действие в меню ниже и следуйте подсказкам.\n\n" +
        "\u{1F4CC} Меню находится внизу экрана.",
      openGameLink:
        "\u{1F3AE} Открываю игру...\n\n" +
        "Нажмите кнопку меню «\u{1F3AE} Играть», чтобы открыть приложение.",
      joinInvite: (players: number, maxPlayers: number, joinLink: string) =>
        "\u{1F4E3} Вас пригласили в игру!\n\n" +
        `\u{1F465} Игроков: ${players}/${maxPlayers}\n\n` +
        `Открыть игру: ${joinLink}`,
      joinNotFound: (code: string) =>
        `\u{26A0}\u{FE0F} Игра с кодом ${code} не найдена или уже закрыта.\n\n` +
        "Попросите друга прислать новый код.",
      anonymousName: "Аноним",
      newUserNotify: (userName: string, userLink: string) =>
        `\u{1F389} Новый пользователь!\n\n${userName} (${userLink})`,
    },
    join: {
      prompt: "\u{1F464} Введите код от друга:",
      notFound: (code: string) =>
        `\u{26A0}\u{FE0F} Сессия с кодом \"${code}\" не найдена.\n\n` +
        "Проверьте код и попробуйте ещё раз.",
      completed: (status: string) =>
        "\u{26A0}\u{FE0F} Эта игра уже завершена.\n\n" +
        `Статус: ${status}\n\n` +
        "Создайте новую игру или присоединитесь к активной.",
      alreadyJoined:
        "\u{26A0}\u{FE0F} Вы уже в этой игре!\n\n" +
        "Нажмите кнопку ниже, чтобы открыть игру:",
      full: (maxPlayers: number) =>
        `\u{26A0}\u{FE0F} Игра уже полная (${maxPlayers}/${maxPlayers} игроков).`,
      closed: (status: string) =>
        "\u{26A0}\u{FE0F} Игра уже завершена.\n\n" +
        `Статус: ${status}\n\n` +
        "Создайте новую игру или присоединитесь к активной.",
      recording:
        "\u{26A0}\u{FE0F} Игра уже началась. Можно присоединиться только к играм в лобби.",
      found: (players: number, maxPlayers: number, category: string, joinLink: string) =>
        "\u{2705} Найдена игра!\n\n" +
        `Игроков: ${players}/${maxPlayers}\n` +
        `Категория: ${category}\n\n` +
        `\u{1F517} Нажмите на ссылку чтобы присоединиться:\n${joinLink}`,
      openGame: "\u{1F3AE} Открыть игру",
    },
    startGame: {
      openLink: (appLink: string) =>
        "\u{1F3AE} Нажми на ссылку чтобы открыть игру:\n\n" +
        `${appLink}`,
    },
    suggestEpisode: {
      info:
        "\u{1F4A1} Предложить эпизод\n\n" +
        "Чтобы предложить эпизод, отправьте видео или ссылку и тайминги реплик.\n\n" +
        "\u{1F4AC} https://t.me/skameeckaa",
    },
    help: {
      base:
        "\u{1F3AE} DubDub — игра, где вы озвучиваете сцены из кино и мемов.\n\n" +
        "1. Выберите категорию и режим\n" +
        "2. Запишите свои реплики по таймингам\n" +
        "3. Дождитесь рендера и получите видео\n" +
        "4. Делитесь результатом с друзьями!\n\n",
      adminBlock:
        "\u{1F6E0} Админ-панель:\n" +
        "/scenes — список сцен\n" +
        "/edit_cues — редактировать тайминги\n" +
        "/stats — статистика\n" +
        "Чтобы добавить сцену — пришлите видео.\n\n",
      openButton: "\u{1F3AE} Открыть DubDub",
      adminButton: "\u{1F6E0} Админ-панель",
      cta: "Нажмите кнопку ниже, чтобы открыть меню \u{1F447}",
    },
    admin: {
      openingPanel: "Открываю админ-панель...",
      panelButton: "\u{1F6E0} Админ-панель",
    },
    scenes: {
      noneWithHint: "Сцен нет. Пришлите видео, чтобы добавить сцену.",
      none: "Сцен нет.",
      listTitle: (count: number) => `\u{1F4CB} Сцены (${count}):`,
      listItem: (
        index: number,
        title: string,
        categoryLabel: string,
        durationSec: number,
        rolesCount: number,
        sceneId: string
      ) =>
        `${index}. ${title}\n   ${categoryLabel}\n   \u{23F1} ${durationSec}s, ${rolesCount} ролей\n   \u{1F194} ${sceneId}`,
    },
    stats: {
      summary: (
        totalUsers: number,
        totalSessions: number,
        todaySessions: number,
        completedSessions: number,
        conversionRate: number,
        scenesCount: number
      ) =>
        "\u{1F4CA} Статистика DubDub\n\n" +
        `\u{1F465} Пользователей: ${totalUsers}\n` +
        `\u{1F4C8} Всего сессий: ${totalSessions}\n` +
        `\u{1F4C5} Сегодня: ${todaySessions}\n` +
        `\u{2705} Завершено: ${completedSessions} (${conversionRate}%)\n` +
        `\u{1F3AC} Сцен: ${scenesCount}`,
    },
    cancelFlow: {
      cancelled: "\u{274C} Действие отменено",
      mainMenu: "Возвращаемся в меню",
    },
    editCues: {
      chooseScene: (list: string) =>
        `\u{1F4CC} Выберите сцену для редактирования:\n\n${list}\n\nОтправьте ID сцены:`,
      listItem: (index: number, title: string, cueStr: string, sceneId: string) =>
        `${index}. *${title}*\n   Тайминги: \`${cueStr}\`\n   ID: \`${sceneId}\``,
      sceneNotFound: (sceneId: string) => `\u{274C} Сцена \"${sceneId}\" не найдена`,
      cueLine: (roleIndex: number, startFrame: number, endFrame: number, startSec: string, endSec: string) =>
        `  Игрок ${roleIndex}: кадры ${startFrame}-${endFrame} (${startSec}s — ${endSec}s)`,
      editingPrompt: (
        title: string,
        durationSec: number,
        fps: number,
        totalFrames: number,
        cueStr: string
      ) =>
        `\u{1F4CC} Редактируем: *${title}*\n\n` +
        `\u{23F1} Длительность: ${durationSec}s\n` +
        `\u{1F3A5} FPS: ${fps}\n` +
        `\u{1F39E} Всего кадров: ${totalFrames}\n` +
        `\u{23F1} Текущие тайминги (в кадрах): \`${cueStr}\`\n\n` +
        "Отправьте новые тайминги в формате:\n" +
        "`0-125, 150-275`",
      invalidFormat:
        "\u{26A0}\u{FE0F} Неверный формат. Используйте диапазоны (кадры): `0-125, 150-275`\n" +
        "Отправьте ещё раз:",
      outOfRange: (maxEndFrame: number, totalFrames: number) =>
        `\u{26A0}\u{FE0F} Конец ${maxEndFrame} выходит за пределы сцены (${totalFrames} кадров).\n` +
        "Отправьте ещё раз:",
      updated: (title: string, cuesLength: number, cueInfo: string) =>
        "\u{2705} Тайминги обновлены!\n\n" +
        `\u{1F3AC} Сцена: ${title}\n` +
        `\u{1F4DD} Реплик: ${cuesLength}\n\n` +
        "Новые тайминги:\n" +
        `${cueInfo}`,
      updateError: "\u{274C} Не удалось обновить тайминги. Попробуйте ещё раз.",
    },
    uploadUrl: {
      emptyMessage: "\u{274C} Ошибка: пустая ссылка",
      usage:
        "\u{1F4E5} Скачивание сцены по ссылке\n\n" +
        "Использование: /upload_url <URL>\n\n" +
        "Пример:\n" +
        "/upload_url https://example.com/video.mp4\n\n" +
        "Мы скачаем файл по ссылке и подготовим сцену.",
      invalidUrl: "\u{274C} Неверный URL. Используйте http:// или https://",
      missingUrl: "\u{274C} Ошибка: не указан URL",
      downloading: "\u{23F3} Скачиваем файл по ссылке...",
      fileDownloaded: (sizeMb: string) =>
        `\u{1F4E5} Файл скачан (${sizeMb} MB). Обрабатываем...`,
      videoProcessed: (
        fileSizeMb: string,
        duration: string,
        fps: string,
        totalFrames: number
      ) =>
        "\u{2705} Видео обработано!\n\n" +
        `\u{1F4E6} Размер: ${fileSizeMb} MB\n` +
        `\u{23F1} Длительность: ${duration} сек\n` +
        `\u{1F3A5} FPS: ${fps}\n` +
        `\u{1F39E} Всего кадров: ${totalFrames}\n\n` +
        "Отправьте тайминги реплик:",
      errorBase: "\u{274C} Не удалось скачать файл по ссылке.",
      errorInvalidUrl: "\u{26A0}\u{FE0F} Неверный URL.",
      errorNotFound: "\u{26A0}\u{FE0F} Файл не найден по ссылке.",
      errorForbidden: "\u{26A0}\u{FE0F} Доступ к файлу запрещён.",
      errorDetails: (details: string) => `Причина: ${details}`,
      linkDetected: (text: string) =>
        "\u{1F517} В сообщении есть ссылка!\n\n" +
        "Хотите скачать файл по ссылке?\n\n" +
        `Используйте команду: /upload_url ${text}\n\n` +
        "Или нажмите кнопку ниже:",
      linkButton: "\u{1F4CE} Скачать по ссылке",
    },
    video: {
      tooLargeForTelegram: (sizeMb: string) =>
        "\u{26A0}\u{FE0F} Видео слишком большое для Telegram (" +
        `${sizeMb} MB).\n\n` +
        "Telegram ограничивает размер файлов. Попробуйте отправить видео до 50 MB.",
      processing: "\u{23F3} Обрабатываем видео...",
      tooLargeToDownload: (sizeMb: string) =>
        "\u{26A0}\u{FE0F} Видео слишком большое для загрузки в Telegram.\n\n" +
        `\u{1F4E6} Размер: ${sizeMb} MB\n\n` +
        "\u{1F4A1} Советы:\n" +
        "1. Обрежьте видео вручную\n" +
        "2. Сожмите до 20-30 MB\n" +
        "3. Отправьте ссылку на файл",
      received: (duration: string, fps: number, totalFrames: number) =>
        "\u{2705} Видео получено!\n" +
        `\u{23F1} Длительность: ${duration} сек\n` +
        `\u{1F3A5} FPS: ${fps}\n` +
        `\u{1F39E} Всего кадров: ${totalFrames}\n\n` +
        "Отправьте тайминги реплик:",
      processErrorBase: "\u{274C} Не удалось обработать видео.",
      processErrorTooBig: (sizeMb: string) =>
        `\u{26A0}\u{FE0F} Файл слишком большой (${sizeMb} MB).\n` +
        "Попробуйте до 20-30 MB.",
      processErrorFfprobe:
        "\u{26A0}\u{FE0F} Не удалось прочитать видео. Убедитесь, что это MP4.",
      processErrorDetails: (details: string) => `Причина: ${details}`,
    },
    pendingScene: {
      titleConfirm: (title: string) =>
        `\u{1F4CC} Подтвердите: \"${title}\"\n\nВыберите категорию:`,
      categoryMovies: "\u{1F3AC} Кино/Сериалы",
      categoryMemes: "\u{1F602} Мемы",
      categoryPolitics: "\u{1F3DB}\u{FE0F} Политика",
      matchMovies: "Кино",
      matchSeries: "сериал",
      matchMemes: "Мем",
      matchPolitics: "Полит",
      matchMoviesEmoji: "\u{1F3AC}",
      matchMemesEmoji: "\u{1F602}",
      matchPoliticsEmoji: "\u{1F3DB}\u{FE0F}",
      invalidCategory: "\u{26A0}\u{FE0F} Выберите категорию из кнопок",
      cuesPrompt: (categoryLabel: string, totalFrames: number, fps: number) =>
        `\u{1F3AC} Категория: ${categoryLabel}\n\n` +
        "Пришлите тайминги реплик в формате:\n\n" +
        "• `0-125, 150-275` (без ролей)\n" +
        "• `Роль 1 - 280 - 367`\n" +
        "• `Роль 2 - 787 - 922`\n\n" +
        `\u{1F39E} Всего кадров: ${totalFrames}\n` +
        `\u{1F3A5} FPS: ${fps}\n\n` +
        "Укажите роли по порядку от 1 до N.",
      cuesInvalid:
        "\u{26A0}\u{FE0F} Неверный формат таймингов.\n\n" +
        "Примеры:\n" +
        "• `0-125, 150-275` (без ролей)\n" +
        "• `Роль 1 - 280 - 367` (с ролями)\n" +
        "• `Роль 2 - 787 - 922`\n\n" +
        "Укажите роли по порядку от 1 до N.\n\n" +
        "Отправьте ещё раз:",
      cuesOutOfRange: (maxEndFrame: number, totalFrames: number) =>
        `\u{26A0}\u{FE0F} Конец ${maxEndFrame} выходит за пределы сцены (${totalFrames} кадров).\n` +
        "Отправьте ещё раз:",
      uploading: "\u{23F3} Загружаем сцену в базу...",
      cueLine: (roleIndex: number, startFrame: number, endFrame: number, startSec: string, endSec: string) =>
        `  Игрок ${roleIndex}: кадры ${startFrame}-${endFrame} (${startSec}s — ${endSec}s)`,
      added: (
        title: string,
        sceneId: string,
        duration: number,
        fps: number,
        rolesCount: number,
        cueInfo: string
      ) =>
        "\u{2705} Сцена добавлена!\n\n" +
        `\u{1F4CC} Название: ${title}\n` +
        `\u{1F194} ID: ${sceneId}\n` +
        `\u{23F1} Длительность: ${duration}s\n` +
        `\u{1F3A5} FPS: ${fps}\n` +
        `\u{1F4CC} Ролей: ${rolesCount}\n\n` +
        "Тайминги:\n" +
        `${cueInfo}`,
      uploadError: "\u{274C} Не удалось добавить сцену. Попробуйте ещё раз.",
    },
    sendToCreator: {
      caption: (botUsername: string, sessionId: string) =>
        "\u{1F4BD} Ваш дубляж готов!\n\n" +
        `Поделиться с друзьями: t.me/${botUsername}?startapp=${sessionId}`,
      shareButton: "\u{1F4E4} Поделиться",
      shareQuery: (botUsername: string, sessionId: string) =>
        `Готово! t.me/${botUsername}?startapp=${sessionId}`,
    },
    errors: {
      generic: "Произошла ошибка. Попробуйте позже.",
      genericShort: "Произошла ошибка",
      noAccess: "\u{26D4} Нет доступа",
    },
  },
} as const;
