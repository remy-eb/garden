/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import chalk from "chalk"
import { BuildTask } from "./build"
import { Module } from "../types/module"
import { PushResult } from "../types/plugin/outputs"
import { Task } from "../tasks/base"
import { Garden } from "../garden"
import { LogEntry } from "../logger/log-entry"

export interface PushTaskParams {
  garden: Garden
  log: LogEntry
  module: Module
  forceBuild: boolean
}

export class PushTask extends Task {
  type = "push"

  private module: Module
  private forceBuild: boolean

  constructor({ garden, log, module, forceBuild }: PushTaskParams) {
    super({ garden, log, version: module.version })
    this.module = module
    this.forceBuild = forceBuild
  }

  async getDependencies() {
    return [new BuildTask({
      garden: this.garden,
      log: this.log,
      module: this.module,
      force: this.forceBuild,
    })]
  }

  getName() {
    return this.module.name
  }

  getDescription() {
    return `pushing module ${this.module.name}`
  }

  async process(): Promise<PushResult> {
    // avoid logging stuff if there is no push handler
    const defaultHandler = async () => ({ pushed: false })
    const handler = await this.garden.getModuleActionHandler({
      moduleType: this.module.type,
      actionType: "pushModule",
      defaultHandler,
    })

    if (handler === defaultHandler) {
      return { pushed: false }
    }

    const log = this.log.info({
      section: this.module.name,
      msg: "Pushing",
      status: "active",
    })

    let result: PushResult
    try {
      result = await this.garden.actions.pushModule({ module: this.module, log })
    } catch (err) {
      log.setError()
      throw err
    }

    if (result.pushed) {
      log.setSuccess({ msg: chalk.green(result.message || `Ready`), append: true })
    } else if (result.message) {
      log.setWarn({ msg: result.message, append: true })
    }

    return result
  }
}
