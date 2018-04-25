/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Command } from "../base"
import { RunModuleCommand } from "./module"

export class RunCommand extends Command {
  name = "run"
  alias = "r"
  help = "Run ad-hoc instances of your modules, services and tests"

  subCommands = [
    new RunModuleCommand(),
  ]

  async action() { }
}
