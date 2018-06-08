import * as Joi from "joi"
import { validate } from "../../types/common"
import {
  GardenPlugin,
} from "../../types/plugin"
import { lambdaHandlers } from "./modules/lambda"
import { mapValues } from "lodash"

export const awsServices = {
  "api-gateway": {},
  kinesis: {},
  dynamodb: {},
  "dynamodb-streams": {},
  elasticsearch: {},
  s3: {},
  firehose: {},
  lambda: {},
  sns: {},
  sqs: {},
  redshift: {},
  es: {},
  ses: {},
  route53: {},
  cloudformation: {},
  cloudwatch: {},
  ssm: {},
}

export const awsServiceNames = Object.keys(awsServices)

export type AwsServiceName = keyof typeof awsServices

export type AwsEndpoints = {
  [name in AwsServiceName]: string
}

export interface AwsConfig {
  endpoints?: AwsEndpoints
}

export const awsConfigSchema = Joi.object().keys({
  endpoints: Joi.object().keys(mapValues(awsServices, Joi.string().uri({ scheme: ["http", "https"] }))),
})

export const gardenPlugin = ({ config }: { config: AwsConfig }): GardenPlugin => {
  config = validate(config, awsConfigSchema, { context: `aws configuration` })

  return {
    config,
    moduleActions: {
      "aws-lambda": lambdaHandlers,
    },
  }
}
