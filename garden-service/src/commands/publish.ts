/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import {
  BooleanParameter,
  Command,
  CommandParams,
  CommandResult,
  handleTaskResults,
  StringsParameter,
} from "./base"
import { Module } from "../types/module"
import { PublishTask } from "../tasks/publish"
import { RuntimeError } from "../exceptions"
import { TaskResults } from "../task-graph"
import { Garden } from "../garden"
import dedent = require("dedent")

const publishArgs = {
  module: new StringsParameter({
    help: "The name of the module(s) to publish (skip to publish all modules). " +
      "Use comma as separator to specify multiple modules.",
  }),
}

const publishOpts = {
  "force-build": new BooleanParameter({
    help: "Force rebuild of module(s) before publishing.",
  }),
  "allow-dirty": new BooleanParameter({
    help: "Allow publishing dirty builds (with untracked/uncommitted changes).",
  }),
}

type Args = typeof publishArgs
type Opts = typeof publishOpts

export class PublishCommand extends Command<Args, Opts> {
  name = "publish"
  help = "Build and publish module(s) to a remote registry."

  description = dedent`
    Publishes built module artifacts for all or specified modules.
    Also builds modules and dependencies if needed.

    Examples:

        garden publish                # publish artifacts for all modules in the project
        garden publish my-container   # only publish my-container
        garden publish --force-build  # force re-build of modules before publishing artifacts
        garden publish --allow-dirty  # allow publishing dirty builds (which by default triggers error)
  `

  arguments = publishArgs
  options = publishOpts

  async action({ garden, args, opts }: CommandParams<Args, Opts>): Promise<CommandResult<TaskResults>> {
    garden.log.header({ emoji: "rocket", command: "Publish modules" })

    const modules = await garden.getModules(args.module)

    const results = await publishModules(garden, modules, !!opts["force-build"], !!opts["allow-dirty"])

    return handleTaskResults(garden, "publish", { taskResults: results })
  }
}

export async function publishModules(
  garden: Garden,
  modules: Module<any>[],
  forceBuild: boolean,
  allowDirty: boolean,
): Promise<TaskResults> {
  for (const module of modules) {
    const version = module.version

    if (version.dirtyTimestamp && !allowDirty) {
      throw new RuntimeError(
        `Module ${module.name} has uncommitted changes. ` +
        `Please commit them, clean the module's source tree or set the --allow-dirty flag to override.`,
        { moduleName: module.name, version },
      )
    }

    const task = new PublishTask({ garden, module, forceBuild })
    await garden.addTask(task)
  }

  return await garden.processTasks()
}
