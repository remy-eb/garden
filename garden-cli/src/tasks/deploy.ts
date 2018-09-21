/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { flatten } from "lodash"
import * as Bluebird from "bluebird"
import chalk from "chalk"
import { LogEntry } from "../logger/log-entry"
import { Task } from "./base"
import {
  Service,
  ServiceStatus,
  prepareRuntimeContext,
} from "../types/service"
import { Module } from "../types/module"
import { withDependants, computeAutoReloadDependants } from "../watch"
import { getNames } from "../util/util"
import { Garden } from "../garden"
import { PushTask } from "./push"

export interface DeployTaskParams {
  garden: Garden
  service: Service
  force: boolean
  forceBuild: boolean
  log: LogEntry
}

export class DeployTask extends Task {
  type = "deploy"

  private service: Service
  private forceBuild: boolean

  constructor({ garden, service, force, forceBuild, log }: DeployTaskParams) {
    super({ garden, log, force, version: service.module.version })
    this.service = service
    this.forceBuild = forceBuild
    this.log = log
  }

  async getDependencies() {
    const serviceDeps = this.service.config.dependencies
    const services = await this.garden.getServices(serviceDeps)

    const deps: Task[] = await Bluebird.map(services, async (service) => {
      return new DeployTask({
        garden: this.garden,
        log: this.log,
        service,
        force: false,
        forceBuild: this.forceBuild,
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
    const status = await this.garden.actions.getServiceStatus({ service: this.service, log })

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
        runtimeContext: await prepareRuntimeContext(this.garden, this.service.module, dependencies),
        log,
        force: this.force,
      })
    } catch (err) {
      log.setError()
      throw err
    }

    log.setSuccess({ msg: chalk.green(`Ready`), append: true })
    return result
  }
}

export async function getDeployTasks(
  { garden, log, module, serviceNames, force = false, forceBuild = false, includeDependants = false }:
    {
      garden: Garden, log: LogEntry, module: Module, serviceNames?: string[] | null,
      force?: boolean, forceBuild?: boolean, includeDependants?: boolean,
    },
) {

  const modulesToProcess = includeDependants
    ? (await withDependants(garden, [module], await computeAutoReloadDependants(garden)))
    : [module]

  const moduleServices = flatten(await Bluebird.map(
    modulesToProcess,
    m => garden.getServices(getNames(m.serviceConfigs))))

  const servicesToProcess = serviceNames
    ? moduleServices.filter(s => serviceNames.includes(s.name))
    : moduleServices

  return servicesToProcess.map(service => new DeployTask({ garden, log, service, force, forceBuild }))
}
