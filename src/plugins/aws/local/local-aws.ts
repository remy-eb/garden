import Bluebird = require("bluebird")
import * as Joi from "joi"
import { validate } from "../../../types/common"
import {
  GardenPlugin,
} from "../../../types/plugin"
import { ConfigureEnvironmentParams } from "../../../types/plugin/params"
import {
  gardenPlugin as awsPlugin,
  awsServiceNames,
  AwsServiceName,
  AwsEndpoints,
} from "../aws"
import { awsServiceDefaultPorts } from "./container"
import {
  getContainerModule,
  serviceDependencies,
  ServiceName,
  getServiceName,
} from "./container"
import { mapValues } from "lodash"

const configSchema = Joi.object().keys({
  services: Joi.array().allow(awsServiceNames).default(["lambda"]),
})

export interface AwsLocalConfig {
  services: ServiceName[]
}

export const gardenPlugin = ({ config }: { config: AwsLocalConfig }): GardenPlugin => {
  config = validate(config, configSchema, { context: `local-aws configuration` })

  // resolve dependencies for enabled services
  const services = new Set<ServiceName>(config.services)
  for (const service of config.services) {
    for (const dep of serviceDependencies[service]) {
      services.add(dep)
    }
  }

  const endpoints = <AwsEndpoints>mapValues(awsServiceDefaultPorts, (port, name) => {
    return `http://${getServiceName(<AwsServiceName>name)}:${port}`
  })

  config.services = <ServiceName[]>Array.from(services)

  const baseConfig = { endpoints }
  const plugin = awsPlugin({ config: baseConfig })

  return {
    config,
    actions: {
      async configureEnvironment({ ctx }: ConfigureEnvironmentParams) {
        // deploy a service for each localstack service type
        // TODO: this is not optimal - would be better to allow for multiple named k8s services per container service
        const module = await getContainerModule(ctx, config)

        await Bluebird.map(Object.keys(module.services), async (serviceName) => {
          const service = await ctx.getService(serviceName)
          const runtimeContext = await service.prepareRuntimeContext({ SERVICES: serviceName })
          return ctx.deployService({ serviceName, runtimeContext })
        })

        return {}
      },
    },
    moduleActions: plugin.moduleActions,
  }
}
