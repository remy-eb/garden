/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import {
  Command,
  CommandParams,
  CommandResult,
} from "./base"
import dedent = require("dedent")
// import { sleep } from "../util/util"

export class ValidateCommand extends Command {
  name = "validate"
  help = "Check your garden configuration for errors."

  description = dedent`
    Throws an error and exits with code 1 if something's not right in your garden.yml files.
  `

  async action({ garden, log }: CommandParams): Promise<CommandResult> {
    garden.log.commandHeader({ emoji: "heavy_check_mark", command: "validate" })

    log.setDone({ msg: "foobar", section: "hey" })
    const i = log.info("foobar2")
    i.info("foobar3")
    garden.log.info("foobar4")
    garden.log.info("foobar5")

    log.info({section: "section", msg: "section test"})

    // await sleep(1500)
    // // garden.log.footer.info("This goes to the footer section!")
    // await sleep(1500)
    // // garden.log.mainBottom.info("This goes to the main bottom section")
    // await sleep(1500)
    // const main = garden.log.info("This goes to the main top section!")
    // main.info("nested main")
    // await sleep(1500)

    // await garden.getModules()

    return {}
  }
}
