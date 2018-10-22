/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { expect } from "chai"
import { join } from "path"
import { mkdirp, pathExists } from "fs-extra"

import { getDataDir, expectError, stubExtSources, stubGitCli, makeTestGarden } from "../../helpers"
import { UpdateRemoteSourcesCommand } from "../../../src/commands/update-remote/sources"
import { UpdateRemoteModulesCommand } from "../../../src/commands/update-remote/modules"
import { Garden } from "../../../src/garden"
import { LogEntry } from "../../../src/logger/log-entry"

describe("UpdateRemoteCommand", () => {
  describe("UpdateRemoteSourcesCommand", () => {
    let garden: Garden
    let log: LogEntry

    beforeEach(async () => {
      garden = await makeTestGarden(projectRoot)
      log = garden.log.info()
      stubGitCli()
    })

    const projectRoot = getDataDir("test-project-ext-project-sources")
    const cmd = new UpdateRemoteSourcesCommand()

    it("should update all project sources", async () => {
      const { result } = await cmd.action({
        garden,
        log,
        args: { source: undefined },
        opts: {},
      })
      expect(result!.map(s => s.name).sort()).to.eql(["source-a", "source-b", "source-c"])
    })

    it("should update the specified project sources", async () => {
      const { result } = await cmd.action({
        garden,
        log,
        args: { source: ["source-a"] },
        opts: {},
      })
      expect(result!.map(s => s.name).sort()).to.eql(["source-a"])
    })

    it("should remove stale remote project sources", async () => {
      const stalePath = join(projectRoot, ".garden", "sources", "project", "stale-source")
      await mkdirp(stalePath)
      await cmd.action({
        garden,
        log,
        args: { source: undefined },
        opts: {},
      })
      expect(await pathExists(stalePath)).to.be.false
    })

    it("should throw if project source is not found", async () => {
      await expectError(
        async () => (
          await cmd.action({
            garden,
            log,
            args: { source: ["banana"] },
            opts: {},
          })
        ),
        "parameter",
      )
    })
  })

  describe("UpdateRemoteModulesCommand", () => {
    let garden: Garden
    let log: LogEntry

    beforeEach(async () => {
      garden = await makeTestGarden(projectRoot)
      log = garden.log.info()
      stubExtSources(garden)
    })

    const projectRoot = getDataDir("test-project-ext-module-sources")
    const cmd = new UpdateRemoteModulesCommand()

    it("should update all modules sources", async () => {
      const { result } = await cmd.action({
        garden,
        log,
        args: { module: undefined },
        opts: {},
      })
      expect(result!.map(s => s.name).sort()).to.eql(["module-a", "module-b", "module-c"])
    })

    it("should update the specified module sources", async () => {
      const { result } = await cmd.action({
        garden,
        log,
        args: { module: ["module-a"] },
        opts: {},
      })
      expect(result!.map(s => s.name).sort()).to.eql(["module-a"])
    })

    it("should remove stale remote module sources", async () => {
      const stalePath = join(projectRoot, ".garden", "sources", "module", "stale-source")
      await mkdirp(stalePath)
      await cmd.action({
        garden,
        log,
        args: { module: undefined },
        opts: {},
      })
      expect(await pathExists(stalePath)).to.be.false
    })

    it("should throw if project source is not found", async () => {
      await expectError(
        async () => (
          await cmd.action({
            garden,
            log,
            args: { module: ["banana"] },
            opts: {},
          })
        ),
        "parameter",
      )
    })
  })
})
