/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as Joi from "joi"
import {
  safeLoad,
  safeLoadAll,
} from "js-yaml"
import { set } from "lodash"
import { join } from "path"
import { PluginContext } from "../../plugin-context"
import {
  joiArray,
  joiIdentifier,
  joiPrimitive,
  Primitive,
  validate,
} from "../../config/common"
import { Module } from "../../types/module"
import { ModuleAndServiceActions } from "../../types/plugin/plugin"
import {
  BuildModuleParams,
  DeployServiceParams,
  GetServiceStatusParams,
  ValidateModuleParams,
  DeleteServiceParams,
} from "../../types/plugin/params"
import {
  BuildResult,
  ValidateModuleResult,
} from "../../types/plugin/outputs"
import { Service, ServiceStatus } from "../../types/service"
import { dumpYaml } from "../../util/util"
import { KubernetesProvider } from "./kubernetes"
import { getAppNamespace } from "./namespace"
import { GARDEN_BUILD_VERSION_FILENAME } from "../../constants"
import { writeTreeVersionFile } from "../../vcs/base"
import { ServiceState } from "../../types/service"
import { compareDeployedObjects, waitForObjects, checkObjectStatus } from "./status"
import { getGenericModuleBuildStatus } from "../generic"
import { ServiceSpec } from "../../config/service"
import { KubeApi } from "./api"
import { BinaryCmd } from "../../util/ext-tools"
import { LogEntry } from "../../logger/log-entry"

export interface KubernetesObject {
  apiVersion: string
  kind: string
  metadata: {
    annotations?: object,
    name: string,
    namespace?: string,
    labels?: object,
  }
  spec?: any
}

export interface HelmServiceSpec extends ServiceSpec {
  chart: string
  repo?: string
  dependencies: string[]
  version?: string
  parameters: { [key: string]: Primitive }
}

export type HelmModuleSpec = HelmServiceSpec

export interface HelmModule extends Module<HelmModuleSpec, HelmServiceSpec> { }

const parameterValueSchema = Joi.alternatives(
  joiPrimitive(),
  Joi.array().items(Joi.lazy(() => parameterValueSchema)),
  Joi.object().pattern(/.+/, Joi.lazy(() => parameterValueSchema)),
)

const helmModuleSpecSchema = Joi.object().keys({
  // TODO: support placing a helm chart in the module directory
  chart: Joi.string()
    .required()
    .description("A valid Helm chart name or URI."),
  repo: Joi.string()
    .description("The repository URL to fetch the chart from."),
  dependencies: joiArray(joiIdentifier())
    .description("List of names of services that should be deployed before this chart."),
  version: Joi.string()
    .description("The chart version to deploy."),
  parameters: Joi.object()
    .pattern(/.+/, parameterValueSchema)
    .default(() => ({}), "{}")
    .description(
      "Map of parameters to pass to Helm when rendering the templates. May include arrays and nested objects.",
    ),
})

const helmStatusCodeMap: { [code: number]: ServiceState } = {
  // see https://github.com/kubernetes/helm/blob/master/_proto/hapi/release/status.proto
  0: "unknown",   // UNKNOWN
  1: "ready",     // DEPLOYED
  2: "missing",   // DELETED
  3: "stopped",   // SUPERSEDED
  4: "unhealthy", // FAILED
  5: "stopped",   // DELETING
  6: "deploying", // PENDING_INSTALL
  7: "deploying", // PENDING_UPGRADE
  8: "deploying", // PENDING_ROLLBACK
}

export const helmHandlers: Partial<ModuleAndServiceActions<HelmModule>> = {
  async validate({ moduleConfig }: ValidateModuleParams): Promise<ValidateModuleResult> {
    moduleConfig.spec = validate(
      moduleConfig.spec,
      helmModuleSpecSchema,
      { context: `helm module ${moduleConfig.name}` },
    )

    const { chart, version, parameters, dependencies } = moduleConfig.spec

    moduleConfig.serviceConfigs = [{
      name: moduleConfig.name,
      dependencies,
      outputs: {},
      spec: { chart, version, parameters, dependencies },
    }]

    // TODO: make sure at least either a chart is specified, or module contains a helm chart
    return moduleConfig
  },

  getBuildStatus: getGenericModuleBuildStatus,
  build,
  getServiceStatus,

  async deployService(
    { ctx, module, service, log, force }: DeployServiceParams<HelmModule>,
  ): Promise<ServiceStatus> {
    const provider = ctx.provider
    const chartPath = await getChartPath(module)
    const valuesPath = getValuesPath(chartPath)
    const namespace = await getAppNamespace(ctx, ctx.provider)
    const releaseName = getReleaseName(namespace, service)

    const releaseStatus = await getReleaseStatus(ctx.provider, releaseName, log)

    if (releaseStatus.state === "missing") {
      const installArgs = [
        "install", chartPath,
        "--name", releaseName,
        "--namespace", namespace,
        "--values", valuesPath,
        "--wait",
      ]
      if (force) {
        installArgs.push("--replace")
      }
      await helm(provider, log, ...installArgs)
    } else {
      const upgradeArgs = [
        "upgrade", releaseName, chartPath,
        "--install",
        "--namespace", namespace,
        "--values", valuesPath,
        "--wait",
      ]
      if (force) {
        upgradeArgs.push("--force")
      }
      await helm(provider, log, ...upgradeArgs)
    }

    const objects = await getChartObjects(ctx, service, log)
    await waitForObjects({ ctx, provider, service, objects, log })

    return {}
  },

  async deleteService(params: DeleteServiceParams): Promise<ServiceStatus> {
    const { ctx, log, service } = params
    const namespace = await getAppNamespace(ctx, ctx.provider)
    const releaseName = getReleaseName(namespace, service)
    await helm(ctx.provider, log, "delete", "--purge", releaseName)
    log.setSuccess("Service deleted")

    return await getServiceStatus(params)
  },
}

async function build({ ctx, module, log }: BuildModuleParams<HelmModule>): Promise<BuildResult> {
  const buildPath = module.buildPath
  const config = module

  // fetch the chart
  const fetchArgs = [
    "fetch", config.spec.chart,
    "--destination", buildPath,
    "--untar",
  ]
  if (config.spec.version) {
    fetchArgs.push("--version", config.spec.version)
  }
  if (config.spec.repo) {
    fetchArgs.push("--repo", config.spec.repo)
  }
  await helm(ctx.provider, log, ...fetchArgs)
  log.setState("Fetching chart...")

  const chartPath = await getChartPath(module)

  // create the values.yml file (merge the configured parameters into the default values)
  log.setState("Preparing chart...")
  const values = safeLoad(await helm(ctx.provider, log, "inspect", "values", chartPath)) || {}

  Object.entries(flattenValues(config.spec.parameters))
    .map(([k, v]) => set(values, k, v))

  const valuesPath = getValuesPath(chartPath)
  await dumpYaml(valuesPath, values)

  // keep track of which version has been built
  const buildVersionFilePath = join(buildPath, GARDEN_BUILD_VERSION_FILENAME)
  const version = module.version
  await writeTreeVersionFile(buildVersionFilePath, {
    latestCommit: version.versionString,
    dirtyTimestamp: version.dirtyTimestamp,
  })

  return { fresh: true }
}

const helmCmd = new BinaryCmd({
  name: "helm",
  specs: {
    darwin: {
      url: "https://storage.googleapis.com/kubernetes-helm/helm-v2.10.0-darwin-amd64.tar.gz",
      sha256: "7c4e6bfbc211d6b984ffb4fa490ce9ac112cc4b9b8d859ece27045b8514c1ed1",
      extract: {
        format: "tar",
        executablePath: ["darwin-amd64", "helm"],
      },
    },
    linux: {
      url: "https://storage.googleapis.com/kubernetes-helm/helm-v2.10.0-linux-amd64.tar.gz",
      sha256: "0fa2ed4983b1e4a3f90f776d08b88b0c73fd83f305b5b634175cb15e61342ffe",
      extract: {
        format: "tar",
        executablePath: ["linux-amd64", "helm"],
      },
    },
    win32: {
      url: "https://storage.googleapis.com/kubernetes-helm/helm-v2.10.0-windows-amd64.tar.gz",
      sha256: "2e82324e33fa76352373d8944d847bee22e4607e9a6c348431663c5cf4ee188e",
      extract: {
        format: "tar",
        executablePath: ["windows-amd64", "helm.exe"],
      },
    },
  },
})

export function helm(provider: KubernetesProvider, log: LogEntry, ...args: string[]) {
  return helmCmd.stdout({
    log,
    args: [
      "--kube-context", provider.config.context,
      ...args,
    ],
  })
}

async function getChartPath(module: HelmModule) {
  const splitName = module.spec.chart.split("/")
  const chartDir = splitName[splitName.length - 1]
  return join(module.buildPath, chartDir)
}

function getValuesPath(chartPath: string) {
  return join(chartPath, "garden-values.yml")
}

async function getChartObjects(ctx: PluginContext, service: Service, log: LogEntry) {
  const chartPath = await getChartPath(service.module)
  const valuesPath = getValuesPath(chartPath)
  const namespace = await getAppNamespace(ctx, ctx.provider)
  const releaseName = getReleaseName(namespace, service)

  const objects = <KubernetesObject[]>safeLoadAll(await helm(ctx.provider, log,
    "template",
    "--name", releaseName,
    "--namespace", namespace,
    "--values", valuesPath,
    chartPath,
  ))

  return objects.filter(obj => obj !== null).map((obj) => {
    if (!obj.metadata.annotations) {
      obj.metadata.annotations = {}
    }
    return obj
  })
}

async function getServiceStatus(
  { ctx, service, module, log, buildDependencies }: GetServiceStatusParams<HelmModule>,
): Promise<ServiceStatus> {
  // need to build to be able to check the status
  const buildStatus = await getGenericModuleBuildStatus({ ctx, module, log, buildDependencies })
  if (!buildStatus.ready) {
    await build({ ctx, module, log, buildDependencies })
  }

  // first check if the installed objects on the cluster match the current code
  const objects = await getChartObjects(ctx, service, log)
  const matched = await compareDeployedObjects(ctx, objects)

  if (!matched) {
    return { state: "outdated" }
  }

  // then check if the rollout is complete
  const version = module.version
  const api = new KubeApi(ctx.provider)
  const namespace = await getAppNamespace(ctx, ctx.provider)
  const { ready } = await checkObjectStatus(api, namespace, objects)

  // TODO: set state to "unhealthy" if any status is "unhealthy"
  const state = ready ? "ready" : "deploying"

  return { state, version: version.versionString }
}

function getReleaseName(namespace: string, service: Service) {
  return `${namespace}--${service.name}`
}

async function getReleaseStatus(
  provider: KubernetesProvider, releaseName: string, log: LogEntry,
): Promise<ServiceStatus> {
  try {
    const res = JSON.parse(await helm(provider, log, "status", releaseName, "--output", "json"))
    const statusCode = res.info.status.code
    return {
      state: helmStatusCodeMap[statusCode],
      detail: res,
    }
  } catch (_) {
    // release doesn't exist
    return { state: "missing" }
  }
}

// adapted from https://gist.github.com/penguinboy/762197
function flattenValues(object, prefix = "") {
  return Object.keys(object).reduce(
    (prev, element) =>
      object[element] && typeof object[element] === "object" && !Array.isArray(object[element])
        ? { ...prev, ...flattenValues(object[element], `${prefix}${element}.`) }
        : { ...prev, ...{ [`${prefix}${element}`]: object[element] } },
    {},
  )
}
