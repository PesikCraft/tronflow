import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { route } from "@/lib/api";

export const POST = route(
  async () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  },
  { public: true },
);
