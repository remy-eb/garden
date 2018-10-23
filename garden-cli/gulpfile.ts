/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { join } from "path"
import { spawn } from "../support/support-util"

const sources = join(__dirname, "**", "*.go")
const dockerfiles = join(__dirname, "docker")

module.exports = (gulp) => {
  gulp.task("build-cli", () => spawn("go", ["build", "-o", join("build", "garden")], __dirname))
  gulp.task("build-container", () => spawn("docker", ["build", "-t", "garden-sync", join(dockerfiles, "sync")]))
  gulp.task("watch", () => gulp.watch([sources, dockerfiles], gulp.parallel("build")))

  gulp.task("build", gulp.series(
    gulp.parallel("build-cli"),
    "build-container",
  ))
}

if (process.cwd() === __dirname) {
  module.exports(require("gulp"))
}
