/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as Bluebird from "bluebird"
import { mapValues, keyBy, sortBy, orderBy, omit } from "lodash"
import { createHash } from "crypto"
import * as Joi from "joi"
import { validate } from "../config/common"
import { join } from "path"
import { GARDEN_VERSIONFILE_NAME } from "../constants"
import { pathExists, readFile, writeFile } from "fs-extra"
import { ConfigurationError } from "../exceptions"
import {
  ExternalSourceType,
  getRemoteSourcesDirname,
  getRemoteSourcePath,
} from "../util/ext-source-util"
import { ModuleConfig } from "../config/module"
import { LogNode } from "../logger/log-node"

export const NEW_MODULE_VERSION = "0000000000"

export interface TreeVersion {
  latestCommit: string
  dirtyTimestamp: number | null
}

export interface TreeVersions { [moduleName: string]: TreeVersion }

export interface ModuleVersion {
  versionString: string
  dirtyTimestamp: number | null
  dependencyVersions: TreeVersions
}

interface NamedTreeVersion extends TreeVersion {
  name: string
}

const versionStringSchema = Joi.string()
  .required()
  .description("String representation of the module version.")

const dirtyTimestampSchema = Joi.number()
  .allow(null)
  .required()
  .description(
    "Set to the last modified time (as UNIX timestamp) if the module contains uncommitted changes, otherwise null.",
  )

export const treeVersionSchema = Joi.object()
  .keys({
    latestCommit: Joi.string()
      .required()
      .description("The latest commit hash of the module source."),
    dirtyTimestamp: dirtyTimestampSchema,
  })

export const moduleVersionSchema = Joi.object()
  .keys({
    versionString: versionStringSchema,
    dirtyTimestamp: dirtyTimestampSchema,
    dependencyVersions: Joi.object()
      .pattern(/.+/, treeVersionSchema)
      .default(() => ({}), "{}")
      .description("The version of each of the dependencies of the module."),
  })

export interface RemoteSourceParams {
  url: string,
  name: string,
  sourceType: ExternalSourceType,
  log: LogNode,
}

export abstract class VcsHandler {
  constructor(protected projectRoot: string) { }

  abstract name: string
  abstract async getTreeVersion(path: string): Promise<TreeVersion>
  abstract async ensureRemoteSource(params: RemoteSourceParams): Promise<string>
  abstract async updateRemoteSource(params: RemoteSourceParams)

  async resolveTreeVersion(path: string): Promise<TreeVersion> {
    // the version file is used internally to specify versions outside of source control
    const versionFilePath = join(path, GARDEN_VERSIONFILE_NAME)
    const fileVersion = await readTreeVersionFile(versionFilePath)
    return fileVersion || this.getTreeVersion(path)
  }

  async resolveVersion(moduleConfig: ModuleConfig, dependencies: ModuleConfig[]): Promise<ModuleVersion> {
    const treeVersion = await this.resolveTreeVersion(moduleConfig.path)

    validate(treeVersion, treeVersionSchema, {
      context: `${this.name} tree version for module at ${moduleConfig.path}`,
    })

    if (dependencies.length === 0) {
      return {
        versionString: getVersionString(treeVersion),
        dirtyTimestamp: treeVersion.dirtyTimestamp,
        dependencyVersions: {},
      }
    }

    const namedDependencyVersions = await Bluebird.map(
      dependencies,
      async (m: ModuleConfig) => ({ name: m.name, ...await this.resolveTreeVersion(m.path) }),
    )
    const dependencyVersions = mapValues(keyBy(namedDependencyVersions, "name"), v => omit(v, "name"))

    // keep the module at the top of the chain, dependencies sorted by name
    const sortedDependencies = sortBy(namedDependencyVersions, "name")
    const allVersions: NamedTreeVersion[] = [{ name: moduleConfig.name, ...treeVersion }].concat(sortedDependencies)

    const dirtyVersions = allVersions.filter(v => !!v.dirtyTimestamp)

    if (dirtyVersions.length > 0) {
      // if any modules are dirty, we resolve with the one(s) with the most recent timestamp
      const latestDirty: NamedTreeVersion[] = []

      for (const v of orderBy(dirtyVersions, "dirtyTimestamp", "desc")) {
        if (latestDirty.length === 0 || v.dirtyTimestamp === latestDirty[0].dirtyTimestamp) {
          latestDirty.push(v)
        } else {
          break
        }
      }

      const dirtyTimestamp = latestDirty[0].dirtyTimestamp

      if (latestDirty.length > 1) {
        // if the last modified timestamp is common across multiple modules, hash their versions
        const versionString = `${hashVersions(latestDirty)}-${dirtyTimestamp}`

        return {
          versionString,
          dirtyTimestamp,
          dependencyVersions,
        }
      } else {
        // if there's just one module that was most recently modified, return that version
        return {
          versionString: getVersionString(latestDirty[0]),
          dirtyTimestamp,
          dependencyVersions,
        }
      }
    } else {
      // otherwise derive the version from all the modules
      const versionString = hashVersions(allVersions)

      return {
        versionString,
        dirtyTimestamp: null,
        dependencyVersions,
      }
    }
  }

  getRemoteSourcesDirname(type: ExternalSourceType) {
    return getRemoteSourcesDirname(type)
  }

  getRemoteSourcePath(name, url, sourceType) {
    return getRemoteSourcePath({ name, url, sourceType })
  }
}

function hashVersions(versions: NamedTreeVersion[]) {
  const versionHash = createHash("sha256")
  versionHash.update(versions.map(v => `${v.name}_${v.latestCommit}`).join("."))
  // this format is kinda arbitrary, but prefixing the "v" is useful to visually spot hashed versions
  return "v" + versionHash.digest("hex").slice(0, 10)
}

async function readVersionFile(path: string, schema): Promise<any> {
  if (!(await pathExists(path))) {
    return null
  }

  // this is used internally to specify version outside of source control
  const versionFileContents = (await readFile(path)).toString().trim()

  if (!versionFileContents) {
    return null
  }

  try {
    return validate(JSON.parse(versionFileContents), schema)
  } catch (error) {
    throw new ConfigurationError(
      `Unable to parse ${path} as valid version file`,
      {
        path,
        versionFileContents,
        error,
      },
    )
  }
}

export async function readTreeVersionFile(path: string): Promise<TreeVersion | null> {
  return readVersionFile(path, treeVersionSchema)
}

export async function writeTreeVersionFile(path: string, version: TreeVersion) {
  await writeFile(path, JSON.stringify(version))
}

export async function readModuleVersionFile(path: string): Promise<ModuleVersion | null> {
  return readVersionFile(path, moduleVersionSchema)
}

export async function writeModuleVersionFile(path: string, version: ModuleVersion) {
  await writeFile(path, JSON.stringify(version))
}

export function getVersionString(treeVersion: TreeVersion) {
  return treeVersion.dirtyTimestamp
    ? `${treeVersion.latestCommit}-${treeVersion.dirtyTimestamp}`
    : treeVersion.latestCommit
}
