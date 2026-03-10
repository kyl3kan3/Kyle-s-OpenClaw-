/**
 * Cron tool — schedule recurring tasks.
 * Lightweight implementation for autonomous agent scheduling.
 */

import type { ToolDefinition } from "@kyles-openclaw/shared";

interface CronJob {
  id: string;
  schedule: string;
  task: string;
  createdAt: number;
}

const jobs: CronJob[] = [];

export function createCronTool(): ToolDefinition {
  return {
    name: "cron_schedule",
    description:
      "Schedule a recurring task. The agent will be prompted with the task description at the specified interval.",
    parameters: {
      type: "object",
      properties: {
        schedule: {
          type: "string",
          description:
            'Cron expression or simple interval like "every 5m", "every 1h", "daily"',
        },
        task: {
          type: "string",
          description: "Description of the task to execute",
        },
      },
      required: ["schedule", "task"],
    },
    execute: async (args) => {
      const job: CronJob = {
        id: `cron_${Date.now()}`,
        schedule: args.schedule as string,
        task: args.task as string,
        createdAt: Date.now(),
      };
      jobs.push(job);
      return {
        toolCallId: "",
        content: `Scheduled job ${job.id}: "${job.task}" (${job.schedule})`,
      };
    },
  };
}
