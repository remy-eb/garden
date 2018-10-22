/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import chalk from "chalk"
import { BuildTask } from "../../tasks/build"
import { RunResult } from "../../types/plugin/outputs"
import {
  BooleanParameter,
  Command,
  CommandParams,
  CommandResult,
  StringParameter,
} from "../base"
import { printRuntimeContext } from "./run"
import dedent = require("dedent")
import { prepareRuntimeContext } from "../../types/service"
import { logHeader } from "../../logger/util"

const runArgs = {
  service: new StringParameter({
    help: "The service to run",
    required: true,
  }),
}

const runOpts = {
  "force-build": new BooleanParameter({ help: "Force rebuild of module" }),
}

type Args = typeof runArgs
type Opts = typeof runOpts

export class RunServiceCommand extends Command<Args, Opts> {
  name = "service"
  alias = "s"
  help = "Run an ad-hoc instance of the specified service"

  description = dedent`
    This can be useful for debugging or ad-hoc experimentation with services.

    Examples:

        garden run service my-service   # run an ad-hoc instance of a my-service and attach to it
  `

  arguments = runArgs
  options = runOpts

  async action({ garden, log, args, opts }: CommandParams<Args, Opts>): Promise<CommandResult<RunResult>> {
    const serviceName = args.service
    const service = await garden.getService(serviceName)
    const module = service.module

    logHeader({
      log,
      emoji: "runner",
      command: `Running service ${chalk.cyan(serviceName)} in module ${chalk.cyan(module.name)}`,
    })

    await garden.actions.prepareEnvironment({ log })

    const buildTask = new BuildTask({ garden, log, module, force: opts["force-build"] })
    await garden.addTask(buildTask)
    await garden.processTasks()

    const dependencies = await garden.getServices(module.serviceDependencyNames)
    const runtimeContext = await prepareRuntimeContext(garden, log, module, dependencies)

    printRuntimeContext(log, runtimeContext)

    const result = await garden.actions.runService({
      log,
      service,
      runtimeContext,
      silent: false,
      interactive: true,
    })

    return { result }
  }
}
