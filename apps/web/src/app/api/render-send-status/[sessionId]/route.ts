import { NextResponse } from "next/server";

const apiBaseUrlRaw =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000";

const API_URL = apiBaseUrlRaw.replace(/\/+$/, "");

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  const initData = request.headers.get("x-tg-init-data") || "";
  const url = `${API_URL}/files/renders/${params.sessionId}/send-status`;

  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(initData ? { "X-TG-INIT-DATA": initData } : {}),
      },
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "proxy_failed" }, { status: 502 });
  }
}
