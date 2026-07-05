import { defineCommand } from "citty";
import { findProjectRoot, runDoctor } from "@envo/core";
import { consola } from "consola";

export const doctorCommand = defineCommand({
  meta: {
    description: "Verify this environment is fully materialized",
  },
  async run() {
    const root = findProjectRoot();
    const report = await runDoctor(root);

    for (const check of report.checks) {
      const icon = check.ok ? "✓" : "✗";
      consola.log(`${icon} ${check.message}`);
      if (!check.ok && check.hint) {
        consola.log(`  → ${check.hint}`);
      }
    }

    if (report.ok) {
      consola.success("\nReady");
      process.exit(0);
    }

    consola.warn("\nEnvironment incomplete");
    process.exit(1);
  },
});
