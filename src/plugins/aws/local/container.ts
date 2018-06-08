import { PluginContext } from "../../../plugin-context"
import {
  ContainerModule,
  ContainerServiceConfig,
} from "../../container"
import {
  AwsServiceName,
  awsServiceNames
} from "../aws"
import { AwsLocalConfig } from "./local-aws"

const containerPort = 80

// we may use these port numbers if we switch to run the services together in one container
export const awsServiceDefaultPorts: { [service in AwsServiceName]: number } = {
  "api-gateway": 4567,
  kinesis: 4568,
  dynamodb: 4569,
  "dynamodb-streams": 4570,
  elasticsearch: 4571,
  s3: 4572,
  firehose: 4573,
  lambda: 4574,
  sns: 4575,
  sqs: 4576,
  redshift: 4577,
  es: 4578,
  ses: 4579,
  route53: 4580,
  cloudformation: 4581,
  cloudwatch: 4582,
  ssm: 4583,
}

export const serviceDependencies: { [name: string]: ServiceName[] } = {
  lambda: ["api-gateway", "s3"],
}

// we use cloudformation to deploy all of the services
for (const name of awsServiceNames) {
  if (serviceDependencies[name]) {
    serviceDependencies[name].push("cloudformation")
  } else {
    serviceDependencies[name] = ["cloudformation"]
  }
}

export type ServiceName = keyof typeof awsServiceDefaultPorts

export function getServiceName(awsName: ServiceName) {
  return "aws-" + awsName
}

export async function getContainerModule(ctx: PluginContext, config: AwsLocalConfig): Promise<ContainerModule> {
  const services = config.services.map(awsName => {
    const name = getServiceName(awsName)
    const dependencies = (serviceDependencies[awsName] || []).map(getServiceName)

    return <ContainerServiceConfig>{
      name,
      dependencies,
      outputs: {},
      spec: {
        command: [],
        daemon: false,
        dependencies,
        endpoints: [{
          paths: ["/"],
          port: "http",
        }],
        env: {
          HOSTNAME: name,
          HOSTNAME_EXTERNAL: name,
          SERVICES: `${awsName}:${containerPort}`,
        },
        name,
        outputs: {},
        ports: [{
          name: "http",
          protocol: "TCP",
          containerPort,
        }],
        volumes: [],
      },
    }
  })

  const moduleConfig = {
    name: "aws-localstack",
    allowPush: false,
    build: {
      dependencies: [],
    },
    path: __dirname,
    type: "container",
    variables: {},
    spec: {
      buildArgs: {},
      command: [],
      image: "localstack/localstack:0.8.6",
      services: services.map(s => s.spec),
      tests: [],
    },
  }

  return new ContainerModule(ctx, moduleConfig, services, [])
}
