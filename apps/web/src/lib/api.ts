import type {
  CreateSessionInput,
  CreateSessionResponse,
  JoinSessionResponse,
  SessionStateResponse,
  UploadTakeResponse,
  FinishSessionResponse,
  RenderStatusResponse,
  SceneListItem,
  SceneDetail,
  ScenesListResponse,
} from "@dubdub/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  initData: string,
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-TG-INIT-DATA": initData,
      ...options?.headers,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      data.error || `HTTP ${res.status}`,
      data.code,
      res.status
    );
  }

  return data as T;
}

export const api = {
  createSession: (
    initData: string,
    input: CreateSessionInput
  ): Promise<CreateSessionResponse> =>
    request(initData, "/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  joinSession: (
    initData: string,
    sessionId: string
  ): Promise<JoinSessionResponse> =>
    request(initData, `/sessions/${sessionId}/join`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getSession: (
    initData: string,
    sessionId: string
  ): Promise<SessionStateResponse> =>
    request(initData, `/sessions/${sessionId}`),

  uploadTake: async (
    initData: string,
    sessionId: string,
    audioBlob: Blob
  ): Promise<UploadTakeResponse> => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    const res = await fetch(`${API_URL}/sessions/${sessionId}/take`, {
      method: "POST",
      headers: {
        "X-TG-INIT-DATA": initData,
      },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new ApiError(data.error || `HTTP ${res.status}`, data.code, res.status);
    }

    return data;
  },

  finishSession: (
    initData: string,
    sessionId: string
  ): Promise<FinishSessionResponse> =>
    request(initData, `/sessions/${sessionId}/finish`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getRenderStatus: (
    initData: string,
    sessionId: string
  ): Promise<RenderStatusResponse> =>
    request(initData, `/renders/${sessionId}`),

  sendVideoToTelegram: (
    initData: string,
    sessionId: string
  ): Promise<{ sent: boolean }> =>
    request(initData, `/files/renders/${sessionId}/send-to-telegram`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  replaySession: (
    initData: string,
    sessionId: string,
    mode: "sameScene" | "newScene"
  ): Promise<SessionStateResponse> =>
    request(initData, `/sessions/${sessionId}/replay?mode=${mode}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Admin endpoints
  checkAdmin: (initData: string): Promise<{ isAdmin: boolean }> =>
    request(initData, "/admin/check"),

  getScenes: (
    initData: string,
    params?: { page?: number; limit?: number; category?: string; search?: string }
  ): Promise<ScenesListResponse> => {
    const query = new URLSearchParams();
    if (params?.page) query.append("page", String(params.page));
    if (params?.limit) query.append("limit", String(params.limit));
    if (params?.category) query.append("category", params.category);
    if (params?.search) query.append("search", params.search);
    const queryStr = query.toString();
    return request(initData, `/admin/scenes${queryStr ? `?${queryStr}` : ""}`);
  },

  getScene: (initData: string, sceneId: string): Promise<SceneDetail> =>
    request(initData, `/admin/scenes/${sceneId}`),

  uploadScene: async (
    initData: string,
    formData: FormData
  ): Promise<{ success: true; sceneId: string }> => {
    const res = await fetch(`${API_URL}/admin/scenes`, {
      method: "POST",
      headers: {
        "X-TG-INIT-DATA": initData,
      },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new ApiError(data.error || `HTTP ${res.status}`, data.code, res.status);
    }

    return data;
  },

  updateScene: async (
    initData: string,
    sceneId: string,
    formData: FormData
  ): Promise<SceneDetail> => {
    const res = await fetch(`${API_URL}/admin/scenes/${sceneId}`, {
      method: "PUT",
      headers: {
        "X-TG-INIT-DATA": initData,
      },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new ApiError(data.error || `HTTP ${res.status}`, data.code, res.status);
    }

    return data;
  },

  deleteScene: (initData: string, sceneId: string): Promise<{ success: true }> =>
    request(initData, `/admin/scenes/${sceneId}`, {
      method: "DELETE",
    }),
};

