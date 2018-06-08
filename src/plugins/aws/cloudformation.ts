import * as AWS from "aws-sdk"
import {
  DeploymentError,
  TimeoutError,
} from "../../exceptions"
import { LogEntry } from "../../logger"
import { sleep } from "../../util"

type CfnStatusMap<T> = { [status in AWS.CloudFormation.Types.StackStatus]: T }

const creatableStatuses: CfnStatusMap<boolean> = {
  CREATE_FAILED: true,
}

const readyStatuses: CfnStatusMap<boolean> = {
  CREATE_COMPLETE: true,
  ROLLBACK_COMPLETE: true,
  UPDATE_COMPLETE: true,
  UPDATE_ROLLBACK_COMPLETE: true,
}

const waitableStatuses: CfnStatusMap<boolean> = {
  CREATE_IN_PROGRESS: true,
  DELETE_IN_PROGRESS: true,
  REVIEW_IN_PROGRESS: true,
  ROLLBACK_IN_PROGRESS: true,
  UPDATE_IN_PROGRESS: true,
  UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS: true,
  UPDATE_ROLLBACK_IN_PROGRESS: true,
}

const pollDelay = 1000
const updateTimeout = 300000

export interface UpdateCfnStackParams {
  cfnOptions: AWS.S3.Types.ClientConfiguration,
  stackName: string,
  cfnResources: object,
  logEntry?: LogEntry,
}

export async function deployCfnStack({ cfnOptions, stackName, cfnResources, logEntry }: UpdateCfnStackParams) {
  const client = getClient(cfnOptions)
  const description = await describeCfnStack(client, stackName)

  logEntry && logEntry.verbose(`Deploying Cloudformation stack ${stackName}...`)

  if (!description || creatableStatuses[description.StackStatus]) {
    await client.createStack({
      StackName: stackName,
      TemplateBody: createTemplateBody(stackName, cfnResources),
    }).promise()

    return waitForUpdate({ client, stackName, logEntry })

  } else if (waitableStatuses[description.StackStatus]) {
    return waitForUpdate({ client, stackName, logEntry })

  } else if (readyStatuses[description.StackStatus]) {
    await client.updateStack({
      StackName: stackName,
      TemplateBody: createTemplateBody(stackName, cfnResources),
    }).promise()

    return waitForUpdate({ client, stackName, logEntry })

  } else {
    const status = description.StackStatus
    throw new DeploymentError(
      `Unexpected status when deploying Cloudformation stack ${stackName}: ${status}`,
      {
        stackName,
        status,
        reason: description.StackStatusReason,
        stackDescription: description,
      },
    )
  }
}

async function describeCfnStack(
  client: AWS.CloudFormation, stackName: string,
): Promise<AWS.CloudFormation.Types.Stack | null> {
  const result = await client.describeStacks({ StackName: stackName }).promise()

  if (result.Stacks) {
    return result.Stacks[0]
  } else {
    return null
  }
}

interface WaitForUpdateParams {
  client: AWS.CloudFormation,
  stackName: string,
  logEntry?: LogEntry,
  lastStatus?: string,
  startedAt?: number,
}

async function waitForUpdate(
  { client, stackName, logEntry, lastStatus, startedAt }: WaitForUpdateParams,
): Promise<AWS.CloudFormation.Types.Stack> {
  const description = await describeCfnStack(client, stackName)

  if (!description || creatableStatuses[description.StackStatus]) {
    throw new DeploymentError(`Cloudformation stack ${stackName} does not exist`, {
      stackName,
    })
  } else if (waitableStatuses[description.StackStatus]) {
    if (!lastStatus || description.StackStatus) {
      lastStatus = description.StackStatus
      logEntry && logEntry.setState(`Waiting until ready... (status: ${lastStatus})`)
    }

    const now = Date.now()

    if (!startedAt) {
      startedAt = now
    } else if (now - startedAt > updateTimeout) {
      throw new TimeoutError(`Timed out deploying stack ${stackName} (status: ${lastStatus})`, {
        stackName,
        lastStatus,
        description,
      })
    }

    await sleep(pollDelay)
    return waitForUpdate({ client, stackName, logEntry, lastStatus, startedAt })

  } else if (readyStatuses[description.StackStatus]) {
    logEntry && logEntry.setDone(`Stack ready`)
    return description

  } else {
    const status = description.StackStatus
    throw new DeploymentError(`Unexpected status when deploying stack ${stackName}: ${status}`, {
      stackName,
      status,
      description,
    })
  }
}

function getClient(cfnOptions: AWS.S3.Types.ClientConfiguration) {
  return new AWS.CloudFormation(cfnOptions)
}

function createTemplateBody(stackName: string, cfnResources: object) {
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Resources: cfnResources,
  }
  return JSON.stringify(template)
}
