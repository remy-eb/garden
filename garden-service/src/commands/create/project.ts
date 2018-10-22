/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { resolve, join, basename } from "path"
import { ensureDir } from "fs-extra"
import Bluebird = require("bluebird")
import dedent = require("dedent")
import terminalLink = require("terminal-link")

import {
  Command,
  CommandParams,
  CommandResult,
  StringParameter,
  PathsParameter,
} from "../base"
import { GardenBaseError } from "../../exceptions"
import {
  prepareNewModuleConfig,
  dumpConfig,
} from "./helpers"
import { prompts } from "./prompts"
import {
  projectTemplate,
  ModuleConfigOpts,
  ProjectConfigOpts,
  moduleSchema,
} from "./config-templates"
import { getChildDirNames } from "../../util/util"
import { validate, joiIdentifier } from "../../config/common"
import { projectSchema } from "../../config/project"

const createProjectOptions = {
  "module-dirs": new PathsParameter({
    help: "Relative path to modules directory. Use comma as a separator to specify multiple directories",
  }),
  name: new StringParameter({
    help: "Assigns a custom name to the project. (Defaults to name of the current directory.)",
  }),
}

const createProjectArguments = {
  "project-dir": new StringParameter({
    help: "Directory of the project. (Defaults to current directory.)",
  }),
}

type Args = typeof createProjectArguments
type Opts = typeof createProjectOptions

const flatten = (acc, val) => acc.concat(val)

interface CreateProjectResult extends CommandResult {
  result: {
    projectConfig: ProjectConfigOpts,
    moduleConfigs: ModuleConfigOpts[],
  }
}

export class CreateProjectCommand extends Command<Args, Opts> {
  name = "project"
  alias = "p"
  help = "Creates a new Garden project."

  description = dedent`
    The 'create project' command walks the user through setting up a new Garden project and
    generates scaffolding based on user input.

    Examples:

        garden create project # creates a new Garden project in the current directory (project name defaults to
        directory name)
        garden create project my-project # creates a new Garden project in my-project directory
        garden create project --module-dirs=path/to/modules1,path/to/modules2
        # creates a new Garden project and looks for pre-existing modules in the modules1 and modules2 directories
        garden create project --name my-project
        # creates a new Garden project in the current directory and names it my-project
  `

  noProject = true
  arguments = createProjectArguments
  options = createProjectOptions

  async action({ garden, args, opts, log }: CommandParams<Args, Opts>): Promise<CreateProjectResult> {
    let moduleConfigs: ModuleConfigOpts[] = []
    let errors: GardenBaseError[] = []

    const projectRoot = args["project-dir"] ? join(garden.projectRoot, args["project-dir"].trim()) : garden.projectRoot
    const moduleParentDirs = await Bluebird.map(opts["module-dirs"] || [], (dir: string) => resolve(projectRoot, dir))
    const projectName = validate(
      opts.name || basename(projectRoot),
      joiIdentifier(),
      { context: "project name" },
    )

    await ensureDir(projectRoot)

    log.info(`Initializing new Garden project ${projectName}`)
    log.info("---------")
    // Stop logger while prompting
    log.stop()

    if (moduleParentDirs.length > 0) {
      // If module-dirs option provided we scan for modules in the parent dir(s) and add them one by one
      moduleConfigs = (await Bluebird.mapSeries(moduleParentDirs, async parentDir => {
        const moduleNames = await getChildDirNames(parentDir)

        return Bluebird.reduce(moduleNames, async (acc: ModuleConfigOpts[], moduleName: string) => {
          const { type } = await prompts.addConfigForModule(moduleName)
          if (type) {
            acc.push(prepareNewModuleConfig(moduleName, type, join(parentDir, moduleName)))
          }
          return acc
        }, [])
      }))
        .reduce(flatten, [])
        .filter(m => m)
    } else {
      // Otherwise we prompt the user for modules to add
      moduleConfigs = (await prompts.repeatAddModule())
        .map(({ name, type }) => prepareNewModuleConfig(name, type, join(projectRoot, name)))
    }

    log.info("---------")
    const taskLog = log.info({ msg: "Setting up project", status: "active" })

    for (const module of moduleConfigs) {
      await ensureDir(module.path)
      try {
        await dumpConfig(module, moduleSchema, log)
      } catch (err) {
        errors.push(err)
      }
    }

    const projectConfig: ProjectConfigOpts = {
      path: projectRoot,
      name: projectName,
      config: projectTemplate(projectName, moduleConfigs.map(module => module.type)),
    }

    try {
      await dumpConfig(projectConfig, projectSchema, log)
    } catch (err) {
      errors.push(err)
    }

    if (errors.length === 0) {
      taskLog.setSuccess()
    } else {
      taskLog.setWarn({ msg: "Finished with errors", append: true })
    }

    const docs = terminalLink("docs", "https://docs.garden.io")
    log.info(`Project created! Be sure to check out our ${docs} for how to get sarted!`)

    return {
      result: {
        moduleConfigs,
        projectConfig,
      },
      errors,
    }
  }
}
