/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Module } from "../../types/module"
import { PrepareEnvironmentParams } from "../../types/plugin/params"
import { Service } from "../../types/service"
import { ConfigurationError } from "../../exceptions"
import { GenericTestSpec } from "../generic"
import { GCloud } from "./gcloud"
import { ModuleSpec } from "../../config/module"
import { BaseServiceSpec } from "../../config/service"
import { Provider } from "../../config/project"

export const GOOGLE_CLOUD_DEFAULT_REGION = "us-central1"

export interface GoogleCloudServiceSpec extends BaseServiceSpec {
  project?: string,
}

export interface GoogleCloudModule<
  M extends ModuleSpec = ModuleSpec,
  S extends GoogleCloudServiceSpec = GoogleCloudServiceSpec,
  T extends GenericTestSpec = GenericTestSpec,
  > extends Module<M, S, T> { }

export async function getEnvironmentStatus() {
  let sdkInfo

  const output = {
    ready: true,
    detail: {
      sdkInstalled: true,
      sdkInitialized: true,
      betaComponentsInstalled: true,
      sdkInfo: {},
    },
  }

  try {
    sdkInfo = output.detail.sdkInfo = await gcloud().json(["info"])
  } catch (err) {
    output.ready = false
    output.detail.sdkInstalled = false
  }

  if (!sdkInfo.config.account) {
    output.ready = false
    output.detail.sdkInitialized = false
  }

  if (!sdkInfo.installation.components.beta) {
    output.ready = false
    output.detail.betaComponentsInstalled = false
  }

  return output
}

export async function prepareEnvironment({ status, log }: PrepareEnvironmentParams) {
  if (!status.detail.sdkInstalled) {
    throw new ConfigurationError(
      "Google Cloud SDK is not installed. " +
      "Please visit https://cloud.google.com/sdk/downloads for installation instructions.",
      {},
    )
  }

  if (!status.detail.betaComponentsInstalled) {
    log.info({
      section: "google-cloud-functions",
      msg: `Installing gcloud SDK beta components...`,
    })
    await gcloud().call(["components update"])
    await gcloud().call(["components install beta"])
  }

  if (!status.detail.sdkInitialized) {
    log.info({
      section: "google-cloud-functions",
      msg: `Initializing SDK...`,
    })
    await gcloud().tty(["init"], { silent: false })
  }

  return {}
}

export function gcloud(project?: string, account?: string) {
  return new GCloud({ project, account })
}

export function getProject<T extends GoogleCloudModule>(service: Service<T>, provider: Provider) {
  return service.spec.project || provider.config["default-project"] || null
}
