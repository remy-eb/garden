/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Command } from "./base"
import { Garden } from "../garden"

export class ValidateCommand extends Command {
  name = "validate"
  help = "Check your garden configuration for errors"

  async action(ctx: Garden) {

    ctx.log.header({ emoji: "heavy_check_mark", command: "validate" })

    await ctx.getModules()
  }
}
