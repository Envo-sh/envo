import { createEnvironment } from "./environments.ts";

export interface CreateOptions {
  name?: string;
  profile?: string;
  agent?: string;
  skills?: string[];
  yes?: boolean;
}

export interface CreateResult {
  root: string;
  projectName: string;
  profile: string;
  environmentName: string;
  configPath: string;
}

export async function createProject(
  cwd: string,
  opts: CreateOptions = {},
): Promise<CreateResult> {
  const result = await createEnvironment(cwd, opts);

  return {
    root: result.root,
    projectName: result.projectName,
    profile: result.environment.profile,
    environmentName: result.environment.name,
    configPath: result.configPath,
  };
}
