import type {
  CreateSessionInput,
  CreateSessionResponse,
  JoinSessionResponse,
  SessionStateResponse,
  UploadTakeResponse,
  FinishSessionResponse,
  RenderStatusResponse,
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
    }),

  getRenderStatus: (
    initData: string,
    sessionId: string
  ): Promise<RenderStatusResponse> =>
    request(initData, `/renders/${sessionId}`),
};

