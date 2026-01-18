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

const apiBaseUrlRaw =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000";

const API_URL = apiBaseUrlRaw.replace(/\/+$/, "");

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

  joinByCode: (
    initData: string,
    code: string
  ): Promise<{ sessionId: string }> =>
    request(initData, `/sessions/join-by-code`, {
      method: "POST",
      body: JSON.stringify({ code }),
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
  ): Promise<{ status: string; jobId?: string; message?: string; error?: string }> =>
    request(initData, `/files/renders/${sessionId}/send-to-telegram`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getSendStatus: (
    initData: string,
    sessionId: string
  ): Promise<{ status: string | null; error: string | null; attempts: number; retryAfterSeconds?: number | null }> =>
    request(initData, `/files/renders/${sessionId}/send-status`, {
      cache: "no-store", // Prevent caching for status polling
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

  // Request replay (for multiplayer - requires confirmation)
  requestReplay: (
    initData: string,
    sessionId: string,
    mode: "sameScene" | "newScene"
  ): Promise<{ requested?: boolean; directReplay?: boolean; waitingForConfirmation?: boolean }> =>
    request(initData, `/sessions/${sessionId}/request-replay?mode=${mode}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Confirm replay (second player confirms or declines)
  confirmReplay: (
    initData: string,
    sessionId: string,
    confirm: boolean
  ): Promise<{ confirmed?: boolean; declined?: boolean; mode?: string }> =>
    request(initData, `/sessions/${sessionId}/confirm-replay?confirm=${confirm}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Get replay status
  getReplayStatus: (
    initData: string,
    sessionId: string
  ): Promise<{ pending: boolean; mode?: string; requestedByName?: string; isRequester?: boolean; confirmed?: boolean }> =>
    request(initData, `/sessions/${sessionId}/replay-status`),

  // Execute confirmed replay
  executeReplay: (
    initData: string,
    sessionId: string
  ): Promise<SessionStateResponse> =>
    request(initData, `/sessions/${sessionId}/execute-replay`, {
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
    console.log("[API] Upload scene: API_URL =", API_URL);
    console.log("[API] Upload scene: initData length =", initData?.length);
    console.log("[API] Upload scene: FormData entries:", Array.from(formData.entries()).map(([k, v]) => [k, v instanceof File ? `${v.name} (${(v.size / 1024 / 1024).toFixed(2)}MB)` : String(v).substring(0, 100)]));
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout
      
      const res = await fetch(`${API_URL}/admin/scenes`, {
        method: "POST",
        headers: {
          "X-TG-INIT-DATA": initData,
          // Don't set Content-Type - browser will set multipart/form-data with boundary
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log("[API] Upload scene response status:", res.status);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${res.status}` };
        }
        console.error("[API] Upload scene error:", errorData);
        throw new ApiError(errorData.error || `HTTP ${res.status}`, errorData.code, res.status);
      }

      const data = await res.json();
      console.log("[API] Upload scene success:", data);
      return data;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      console.error("[API] Upload scene network error:", err);
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiError("Request timeout. File may be too large.", "TIMEOUT");
      }
      throw new ApiError(
        err instanceof Error ? err.message : "Failed to upload scene",
        "NETWORK_ERROR"
      );
    }
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

  deleteScene: (initData: string, sceneId: string, force: boolean = false): Promise<{ success: true }> =>
    request(initData, `/admin/scenes/${sceneId}${force ? "?force=true" : ""}`, {
      method: "DELETE",
    }),
};

