/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as Bluebird from "bluebird"
import chalk from "chalk"
import { includes } from "lodash"
import { LogEntry } from "../logger/log-entry"
import { Task } from "./base"
import {
  Service,
  ServiceStatus,
  prepareRuntimeContext,
} from "../types/service"
import { Garden } from "../garden"
import { PushTask } from "./push"

export interface DeployTaskParams {
  garden: Garden
  service: Service
  force: boolean
  forceBuild: boolean
  log: LogEntry
  //TODO: Move watch and hotReloadServiceNames to a new commandContext object?
  watch?: boolean
  hotReloadServiceNames?: string[]
}

export class DeployTask extends Task {
  type = "deploy"

  private service: Service
  private forceBuild: boolean
  private watch: boolean
  private hotReloadServiceNames?: string[]

  constructor({ garden, log, service, force, forceBuild, watch, hotReloadServiceNames }: DeployTaskParams) {
    super({ garden, log, force, version: service.module.version })
    this.service = service
    this.forceBuild = forceBuild
    this.watch = !!watch
    this.hotReloadServiceNames = hotReloadServiceNames
  }

  async getDependencies() {
    const servicesToDeploy = (await this.garden.getServices(this.service.config.dependencies))
      .filter(s => !includes(this.hotReloadServiceNames, s.name))

    const deps: Task[] = await Bluebird.map(servicesToDeploy, async (service) => {
      return new DeployTask({
        garden: this.garden,
        log: this.log,
        service,
        force: false,
        forceBuild: this.forceBuild,
        watch: this.watch,
        hotReloadServiceNames: this.hotReloadServiceNames,
      })
    })

    deps.push(new PushTask({
      garden: this.garden,
      log: this.log,
      module: this.service.module,
      forceBuild: this.forceBuild,
    }))

    return deps
  }

  protected getName() {
    return this.service.name
  }

  getDescription() {
    return `deploying service ${this.service.name} (from module ${this.service.module.name})`
  }

  async process(): Promise<ServiceStatus> {
    const log = this.log.info({
      section: this.service.name,
      msg: "Checking status",
      status: "active",
    })

    // TODO: get version from build task results
    const { versionString } = await this.service.module.version
    const hotReloadEnabled = includes(this.hotReloadServiceNames, this.service.name)
    const status = await this.garden.actions.getServiceStatus({
      service: this.service,
      verifyHotReloadStatus: hotReloadEnabled ? "enabled" : "disabled",
      log,
    })

    if (
      !this.force &&
      versionString === status.version &&
      status.state === "ready"
    ) {
      // already deployed and ready
      log.setSuccess({
        msg: `Version ${versionString} already deployed`,
        append: true,
      })
      return status
    }

    log.setState("Deploying")

    const dependencies = await this.garden.getServices(this.service.config.dependencies)

    let result: ServiceStatus
    try {
      result = await this.garden.actions.deployService({
        service: this.service,
        runtimeContext: await prepareRuntimeContext(this.garden, log, this.service.module, dependencies),
        log,
        force: this.force,
        hotReload: hotReloadEnabled,
      })
    } catch (err) {
      log.setError()
      throw err
    }

    log.setSuccess({ msg: chalk.green(`Ready`), append: true })
    return result
  }
}
