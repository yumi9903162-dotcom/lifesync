import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});

const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const cronSecret = Deno.env.get("REMINDER_CRON_SECRET") || "";
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

function cleanText(value: unknown, max: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

async function currentUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  return error ? null : data.user;
}

async function deliverDue() {
  if (!publicKey || !privateKey) throw new Error("VAPID secrets are missing");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const { data: reminders, error } = await admin.from("scheduled_reminders")
    .select("user_id,reminder_key,title,body,silent,target_url")
    .is("delivered_at", null).lte("fire_at", new Date().toISOString())
    .order("fire_at", { ascending: true }).limit(500);
  if (error) throw error;
  let sent = 0;
  for (const reminder of reminders || []) {
    const { data: subscriptions } = await admin.from("push_subscriptions")
      .select("id,subscription").eq("user_id", reminder.user_id);
    for (const row of subscriptions || []) {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({
          title: reminder.title,
          body: reminder.body,
          silent: reminder.silent,
          url: reminder.target_url,
          key: reminder.reminder_key,
          tag: reminder.reminder_key,
        }));
        sent += 1;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", row.id);
        else console.error("push failed", status, error);
      }
    }
    await admin.from("scheduled_reminders").update({ delivered_at: new Date().toISOString() })
      .eq("user_id", reminder.user_id).eq("reminder_key", reminder.reminder_key);
  }
  return { processed: reminders?.length || 0, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return json({ publicKey, ready: Boolean(publicKey && privateKey) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    if (body.action === "deliver") {
      if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "Unauthorized" }, 401);
      return json(await deliverDue());
    }
    const user = await currentUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (body.action === "subscribe") {
      const sub = body.subscription;
      const endpoint = cleanText(sub?.endpoint, 4096);
      if (!endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ error: "Invalid subscription" }, 400);
      const { error } = await admin.from("push_subscriptions").upsert({
        user_id: user.id, endpoint, subscription: sub, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,endpoint" });
      if (error) throw error;
      return json({ ok: true });
    }
    if (body.action === "sync") {
      const reminders = Array.isArray(body.reminders) ? body.reminders.slice(0, 1500) : [];
      const rows = reminders.flatMap((item: Record<string, unknown>) => {
        const fireAt = new Date(String(item.fireAt));
        const reminderKey = cleanText(item.key, 240);
        if (!Number.isFinite(fireAt.getTime()) || !reminderKey) return [];
        return [{
          user_id: user.id,
          reminder_key: reminderKey,
          fire_at: fireAt.toISOString(),
          title: cleanText(item.title, 160),
          body: cleanText(item.body, 300),
          silent: item.silent === true,
          target_url: cleanText(item.url, 500) || "./index.html",
          delivered_at: null,
          updated_at: new Date().toISOString(),
        }];
      });
      await admin.from("scheduled_reminders").delete().eq("user_id", user.id)
        .is("delivered_at", null).gte("fire_at", new Date().toISOString());
      if (rows.length) {
        const { error } = await admin.from("scheduled_reminders").upsert(rows, { onConflict: "user_id,reminder_key" });
        if (error) throw error;
      }
      return json({ ok: true, count: rows.length });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
