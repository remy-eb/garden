/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as Bluebird from "bluebird"
import chalk from "chalk"
import { Module } from "../types/module"
import { BuildResult } from "../types/plugin/outputs"
import { Task } from "../tasks/base"
import { Garden } from "../garden"
import { LogEntry } from "../logger/log-entry"

export interface BuildTaskParams {
  garden: Garden
  log: LogEntry
  module: Module
  force: boolean
}

export class BuildTask extends Task {
  type = "build"

  private module: Module

  constructor({ garden, log, force, module }: BuildTaskParams) {
    super({ garden, log, force, version: module.version })
    this.module = module
  }

  async getDependencies(): Promise<BuildTask[]> {
    const deps = await this.garden.resolveModuleDependencies(this.module.build.dependencies, [])
    return Bluebird.map(deps, async (m: Module) => {
      return new BuildTask({
        garden: this.garden,
        log: this.log,
        module: m,
        force: this.force,
      })
    })
  }

  protected getName() {
    return this.module.name
  }

  getDescription() {
    return `building ${this.module.name}`
  }

  async process(): Promise<BuildResult> {
    const module = this.module

    if (!this.force && (await this.garden.actions.getBuildStatus({ log: this.log, module })).ready) {
      // this is necessary in case other modules depend on files from this one
      await this.garden.buildDir.syncDependencyProducts(this.module)
      return { fresh: false }
    }

    const log = this.log.info({
      section: this.module.name,
      msg: "Building",
      status: "active",
    })

    let result: BuildResult
    try {
      result = await this.garden.actions.build({
        module,
        log,
      })
    } catch (err) {
      log.setError()
      throw err
    }

    log.setSuccess({ msg: chalk.green(`Done (took ${log.getDuration(1)} sec)`), append: true })
    return result
  }
}
