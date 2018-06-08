/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { existsSync } from "fs"
import * as Joi from "joi"
import * as AWS from "aws-sdk"
import archiver = require("archiver-promise")
import {
  joiArray,
  validate,
} from "../../../types/common"
import {
  ModuleSpec,
} from "../../../types/module"
import { ModuleActions } from "../../../types/plugin"
import {
  BuildModuleParams,
  DeployServiceParams,
  GetModuleBuildStatusParams,
  GetServiceOutputsParams,
  ParseModuleParams,
} from "../../../types/plugin/params"
import {
  baseServiceSchema,
  BaseServiceSpec,
  RuntimeContext,
  ServiceEndpoint,
  ServiceStatus,
} from "../../../types/service"
import {
  buildGenericModule,
  genericTestSchema,
  GenericTestSpec,
  testGenericModule,
} from "../../generic"
import { deployCfnStack } from "../cloudformation"
import { uploadToS3 } from "../s3"
import {
  AwsModule,
  AwsService,
} from "./base"
import { resolve } from "path"

const s3Bucket = "garden-lambda"

export interface AwsLambdaServiceSpec extends BaseServiceSpec {
  handler: string
  memorySize: number
  // TODO: get type from SDK
  runtime: string
  timeout: number
}

const serviceSpecSchema = baseServiceSchema.keys({
  name: Joi.string().required(),
  handler: Joi.string().required(),
  memorySize: Joi.number().integer().default(128),
  runtime: Joi.string().required(),
  timeout: Joi.number().integer().default(100),
})

export interface AwsLambdaModuleSpec extends ModuleSpec {
  packageSources: string[]
  functions: AwsLambdaServiceSpec[]
  tests: GenericTestSpec[],
}

const moduleSpecSchema = Joi.object().keys({
  packageSources: Joi.array().items(Joi.string().uri(<any>{ relativeOnly: true })).required(),
  functions: joiArray(serviceSpecSchema),
  tests: joiArray(genericTestSchema),
})

export class AwsLambdaModule extends AwsModule<AwsLambdaModuleSpec, AwsLambdaServiceSpec> { }

export class AwsLambdaService extends AwsService<AwsLambdaModule> { }

export const lambdaHandlers: Partial<ModuleActions<AwsLambdaModule>> = {
  parseModule: async ({ ctx, moduleConfig }: ParseModuleParams<AwsLambdaModule>) => {
    moduleConfig.spec = validate(moduleConfig.spec, moduleSpecSchema, { context: `${moduleConfig.name} module` })

    const services = moduleConfig.spec.functions.map(spec => ({
      name: spec.name,
      dependencies: spec.dependencies,
      outputs: spec.outputs,
      spec,
    }))

    const tests = moduleConfig.spec.tests.map(t => ({
      name: t.name,
      dependencies: t.dependencies,
      timeout: t.timeout,
      variables: t.variables,
      spec: t,
    }))

    return {
      module: moduleConfig,
      services,
      tests,
    }
  },

  getModuleBuildStatus: async ({ module }: GetModuleBuildStatusParams<AwsLambdaModule>) => {
    const packagePath = await getS3PackagePath(module)
    const ready = existsSync(packagePath)
    return { ready }
  },

  buildModule: async ({ ctx, env, provider, module }: BuildModuleParams<AwsLambdaModule>) => {
    // run build command
    const result = await buildGenericModule({ ctx, env, provider, module })

    // package function
    const buildPath = await module.getBuildPath()
    const packagePath = await getS3PackagePath(module)
    const archive = archiver(packagePath, { zlib: { level: 9 } })

    const config = await module.config
    config.spec.packageSources.map(s => archive.file(resolve(buildPath, s), { name: s }))

    await archive.finalize()

    return result
  },

  deployService: async (
    { ctx, provider, module, service, runtimeContext, logEntry }: DeployServiceParams<AwsLambdaModule>,
  ): Promise<ServiceStatus> => {
    // push package to S3 bucket
    let s3Endpoint: string | undefined
    let cfnEndpoint: string | undefined

    if (provider.name === "local-aws") {
      const s3Service = await ctx.getService("aws-s3")
      s3Endpoint = (await s3Service.getEndpoint("/")).url

      const cfnService = await ctx.getService("aws-cloudformation")
      cfnEndpoint = (await cfnService.getEndpoint("/")).url
    }

    const filename = await getS3PackageFilename(module)
    const packagePath = await getS3PackagePath(module)
    const s3Opts = { endpoint: s3Endpoint }
    await uploadToS3(s3Opts, packagePath, provider.config.lambdaS3Bucket, filename)

    // deploy cloudformation template
    const stack = await deployCfnStack({
      cfnOptions: { endpoint: cfnEndpoint },
      stackName: getCfnStackName(service),
      cfnResources: await getCfnResources(service, runtimeContext),
      logEntry,
    })

    return stackToStatus(service, stack)
  },

  getServiceOutputs: async ({ provider, service }: GetServiceOutputsParams<AwsLambdaModule>) => {

  },

  testModule: testGenericModule,
}

async function getS3PackageFilename(module: AwsLambdaModule) {
  const version = await module.getVersion()
  return `${module.name}.${version.versionString}.zip`
}

async function getS3PackagePath(module: AwsLambdaModule) {
  const buildPath = await module.getBuildPath()
  const filename = await getS3PackageFilename(module)
  return resolve(buildPath, filename)
}

function getCfnStackName(service: AwsLambdaService) {
  return `garden-lambda-${service.name}`
}

function getLambdaHostname(service: AwsLambdaService) {

}

async function stackToStatus(service: AwsLambdaService, stack: AWS.CloudFormation.Types.Stack): Promise<ServiceStatus> {
  const version = await service.module.getVersion()
  const hostname = "?"
  const endpoints: ServiceEndpoint[] = [{
    hostname,
    protocol: "tcp",
  }]

  return {
    version: version.versionString,
    state: "ready",
    endpoints,
    createdAt: stack.CreationTime.toISOString(),
    updatedAt: stack.LastUpdatedTime && stack.LastUpdatedTime.toISOString(),
    detail: stack,
  }

}

async function getCfnResources(service: AwsLambdaService, runtimeContext: RuntimeContext): Promise<object> {
  return {
    LambdaRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Principal: { Service: ["lambda.amazonaws.com"] },
            Action: ["sts:AssumeRole"],
          }],
        },
        Path: "/",
        Policies: [{
          PolicyName: "root",
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: ["logs:*"], Resource: "arn:aws:logs:*:*:*" }],
          },
        }],
      },
    },
    LambdaFunction: {
      Type: "AWS::Lambda::Function",
      Properties: {
        Handler: service.config.spec.handler,
        Code: {
          S3Bucket: s3Bucket,
          S3Key: await getS3PackageFilename(service.module),
        },
        Role: { "Fn::GetAtt": ["LambdaRole", "Arn"] },
        Runtime: service.config.spec.runtime,
        Timeout: service.config.spec.timeout,
        MemorySize: service.config.spec.memorySize,
        Environment: {
          Variables: runtimeContext.envVars,
        },
        TracingConfig: {
          Mode: "Active",
        },
      },
    },
    GatewayApi: {
      Type: "AWS::ApiGateway::RestApi",
      Name: service.name,
    },
    GatewayLambdaProxy: {
      Type: "AWS::ApiGateway::Method",
      Properties: {
        AuthorizationType: "NONE",
        HttpMethod: "ANY",
        ResourceId: { Ref: "ProxyResource" },
        RestApiId: { Ref: "GatewayApi" },
        Integration: {
          Type: "AWS_PROXY",
          IntegrationHttpMethod: "POST",
          Uri: [
            "arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${Arn}/invocations",
            { Arn: { "Fn::GetAtt": [ "LambdaFunction", "Arn" ] } },
          ],
        },
      },
    },
  }
}
