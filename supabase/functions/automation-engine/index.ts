import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown>;
  old_record: Record<string, unknown> | null;
}

interface AutomationRule {
  id: string;
  workspace_id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  created_by: string;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const payload: WebhookPayload = await req.json();
    const { type, table, record, old_record } = payload;

    // Only process UPDATEs
    if (type !== "UPDATE") {
      return new Response(JSON.stringify({ skipped: "not an UPDATE" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const workspaceId = record.workspace_id as string;
    if (!workspaceId) {
      return new Response(JSON.stringify({ skipped: "no workspace_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active automation rules for this workspace
    const { data: rules, error: rulesErr } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    if (rulesErr) throw rulesErr;
    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine entity type from table name
    const entityType = table === "tasks" ? "task" : table === "deals" ? "deal" : table;
    const entityId = record.id as string;

    const results: string[] = [];

    for (const rule of rules as AutomationRule[]) {
      const matched = await evaluateTrigger(rule, table, record, old_record, supabase);
      if (!matched) continue;

      try {
        const result = await executeAction(rule, table, record, supabase);
        results.push(`Rule "${rule.name}": ${result}`);
        console.log(`[automation-engine] Rule "${rule.name}" fired → ${result}`);

        // Log successful run to automation_runs
        await supabase.from("automation_runs").insert({
          workspace_id: workspaceId,
          automation_rule_id: rule.id,
          triggered_by_entity_type: entityType,
          triggered_by_entity_id: entityId,
          status: "success",
          result_message: result,
          error_message: null,
        });
      } catch (actionErr) {
        const errMsg = String(actionErr);
        console.error(`[automation-engine] Rule "${rule.name}" FAILED:`, errMsg);

        // Log failed run to automation_runs
        await supabase.from("automation_runs").insert({
          workspace_id: workspaceId,
          automation_rule_id: rule.id,
          triggered_by_entity_type: entityType,
          triggered_by_entity_id: entityId,
          status: "failed",
          result_message: null,
          error_message: errMsg,
        });

        results.push(`Rule "${rule.name}": FAILED — ${errMsg}`);
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[automation-engine] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Trigger evaluation ────────────────────────────────────────────────────────

async function evaluateTrigger(
  rule: AutomationRule,
  table: string,
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null,
  // deno-lint-ignore no-explicit-any
  _supabase: any,
): Promise<boolean> {
  const cfg = rule.trigger_config;

  switch (rule.trigger_type) {
    case "task_status_change": {
      if (table !== "tasks") return false;
      const targetStatus = cfg.target_status as string;
      if (!targetStatus) return false;
      // Status must have actually changed to the target value
      return record.status === targetStatus && oldRecord?.status !== targetStatus;
    }

    case "deal_stage_change": {
      if (table !== "deals") return false;
      const stageId = cfg.stage_id as string;
      if (!stageId) return false;
      return record.deal_stage_id === stageId && oldRecord?.deal_stage_id !== stageId;
    }

    case "due_date_passed": {
      if (table !== "tasks") return false;
      const daysAfter = (cfg.days_after as number) ?? 0;
      const dueDate = record.due_date as string | null;
      if (!dueDate) return false;
      const due = new Date(dueDate);
      const threshold = new Date(due.getTime() + daysAfter * 86400000);
      const now = new Date();
      // Fire if now >= threshold and status not done
      return now >= threshold && record.status !== "done";
    }

    case "task_assigned": {
      if (table !== "tasks") return false;
      // Check if assigned_to field actually changed
      if (record.assigned_to === oldRecord?.assigned_to) return false;
      if (!record.assigned_to) return false;
      // Optional: filter to specific assignee
      const assigneeId = cfg.assignee_id as string | undefined;
      if (assigneeId && record.assigned_to !== assigneeId) return false;
      return true;
    }

    default:
      return false;
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function executeAction(
  rule: AutomationRule,
  table: string,
  record: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
  const cfg = rule.action_config;

  switch (rule.action_type) {
    case "update_field": {
      return await executeUpdateField(cfg, table, record, supabase);
    }

    case "send_notification": {
      // Log as an activity (notification delivery is a platform concern)
      const recipient = cfg.recipient as string;
      const message = interpolate(cfg.message as string, record);
      const subject = `Notification to ${recipient}: ${message.slice(0, 80)}`;
      await supabase.from("activities").insert({
        workspace_id: record.workspace_id,
        type: "note",
        subject,
        body_text: message,
        related_task_id: table === "tasks" ? record.id : null,
        related_deal_id: table === "deals" ? record.id : null,
        created_by: rule.created_by,
      });
      return `notification logged for ${recipient}`;
    }

    case "create_activity": {
      const actType = cfg.activity_type as string ?? "note";
      const message = interpolate(cfg.message as string ?? "", record);
      await supabase.from("activities").insert({
        workspace_id: record.workspace_id,
        type: actType,
        subject: message.slice(0, 200) || `Auto-activity from rule "${rule.name}"`,
        body_text: message,
        related_task_id: table === "tasks" ? record.id : null,
        related_deal_id: table === "deals" ? record.id : null,
        related_project_id: record.project_id ?? null,
        created_by: rule.created_by,
      });
      return `activity "${actType}" created`;
    }

    case "move_task": {
      if (table !== "tasks") return "skipped (not a task)";
      const targetStatus = cfg.target_status as string;
      if (!targetStatus) return "skipped (no target_status)";
      const { error } = await supabase
        .from("tasks")
        .update({ status: targetStatus, updated_at: new Date().toISOString() })
        .eq("id", record.id);
      if (error) throw error;
      return `task moved to "${targetStatus}"`;
    }

    default:
      return "unknown action type";
  }
}

// ── update_field with special-case: task done → unblock dependent tasks ───────

async function executeUpdateField(
  cfg: Record<string, unknown>,
  table: string,
  record: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
  const entity = cfg.entity as string;
  const field = cfg.field as string;
  const value = cfg.value as string;

  // Special case: task status_change to done → smart unblock
  if (entity === "task" && field === "status" && value === "in_progress" && table === "tasks") {
    return await smartUnblockDependentTasks(record, supabase);
  }

  // Generic field update on the triggering record
  if (entity === "task" && table === "tasks") {
    const { error } = await supabase
      .from("tasks")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", record.id);
    if (error) throw error;
    return `task.${field} updated to "${value}"`;
  }

  if (entity === "deal" && table === "deals") {
    const { error } = await supabase
      .from("deals")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", record.id);
    if (error) throw error;
    return `deal.${field} updated to "${value}"`;
  }

  return `skipped (entity/table mismatch: ${entity}/${table})`;
}

// ── Smart unblock: only promote blocked task when ALL its blockers are done ───

async function smartUnblockDependentTasks(
  completedTask: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
  const taskId = completedTask.id as string;

  // Find all tasks that are blocked by this (now-completed) task
  const { data: deps, error: depsErr } = await supabase
    .from("task_dependencies")
    .select("blocked_task_id")
    .eq("blocking_task_id", taskId);

  if (depsErr) throw depsErr;
  if (!deps || deps.length === 0) return "no dependent tasks";

  const unblocked: string[] = [];

  for (const dep of deps) {
    const blockedTaskId = dep.blocked_task_id as string;

    // Find ALL blocking tasks for this blocked task
    const { data: allBlockers, error: blockersErr } = await supabase
      .from("task_dependencies")
      .select("blocking_task_id, blocking_task:tasks!task_dependencies_blocking_task_id_fkey(id, status)")
      .eq("blocked_task_id", blockedTaskId);

    if (blockersErr) throw blockersErr;

    // Check if ALL blockers are now done
    const allDone = (allBlockers ?? []).every(
      (b: { blocking_task: { id: string; status: string } | null }) =>
        b.blocking_task?.status === "done" || b.blocking_task?.id === taskId,
    );

    if (!allDone) {
      console.log(`[automation-engine] Task ${blockedTaskId} still has pending blockers — not unblocking`);
      continue;
    }

    // Only move to in_progress if currently in backlog or todo
    const { data: blockedTask } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", blockedTaskId)
      .single();

    if (!blockedTask || !["backlog", "todo"].includes(blockedTask.status)) {
      continue;
    }

    const { error: updateErr } = await supabase
      .from("tasks")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", blockedTaskId);

    if (updateErr) throw updateErr;
    unblocked.push(blockedTaskId);

    // Log activity
    await supabase.from("activities").insert({
      workspace_id: completedTask.workspace_id,
      type: "status_change",
      subject: `Task automatically moved to In Progress after all blockers completed`,
      related_task_id: blockedTaskId,
      related_project_id: completedTask.project_id ?? null,
      created_by: completedTask.assigned_to ?? completedTask.reporter,
    });
  }

  return unblocked.length > 0
    ? `unblocked ${unblocked.length} task(s): ${unblocked.join(", ")}`
    : "all dependent tasks still have pending blockers";
}

// ── Interpolation helper ──────────────────────────────────────────────────────

function interpolate(template: string, record: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const parts = key.split(".");
    if (parts[0] === "task" || parts[0] === "deal") {
      return String(record[parts[1]] ?? "");
    }
    return String(record[key] ?? "");
  });
}
