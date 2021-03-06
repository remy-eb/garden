import { expect } from "chai"
import { join } from "path"

import { LinkModuleCommand } from "../../../src/commands/link/module"
import {
  getDataDir,
  expectError,
  cleanProject,
  stubExtSources,
  makeTestGarden,
} from "../../helpers"
import { LinkSourceCommand } from "../../../src/commands/link/source"
import { Garden } from "../../../src/garden"

describe("LinkCommand", () => {
  let garden: Garden

  describe("LinkModuleCommand", () => {
    const cmd = new LinkModuleCommand()
    const projectRoot = getDataDir("test-project-ext-module-sources")

    beforeEach(async () => {
      garden = await makeTestGarden(projectRoot)
      stubExtSources(garden)
    })

    afterEach(async () => {
      await cleanProject(projectRoot)
    })

    it("should link external modules", async () => {
      await cmd.action({
        garden,
        args: {
          module: "module-a",
          path: join(projectRoot, "mock-local-path", "module-a"),
        },
        opts: {},
      })

      const { linkedModuleSources } = await garden.localConfigStore.get()

      expect(linkedModuleSources).to.eql([
        { name: "module-a", path: join(projectRoot, "mock-local-path", "module-a") },
      ])
    })

    it("should handle relative paths", async () => {
      await cmd.action({
        garden,
        args: {
          module: "module-a",
          path: join("mock-local-path", "module-a"),
        },
        opts: {},
      })

      const { linkedModuleSources } = await garden.localConfigStore.get()

      expect(linkedModuleSources).to.eql([
        { name: "module-a", path: join(projectRoot, "mock-local-path", "module-a") },
      ])
    })

    it("should throw if module to link does not have an external source", async () => {
      await expectError(
        async () => (
          await cmd.action({
            garden,
            args: {
              module: "banana",
              path: "",
            },
            opts: {},
          })
        ),
        "parameter",
      )
    })
  })

  describe("LinkSourceCommand", () => {
    const cmd = new LinkSourceCommand()
    const projectRoot = getDataDir("test-project-ext-project-sources")

    beforeEach(async () => {
      garden = await makeTestGarden(projectRoot)
      stubExtSources(garden)
    })

    afterEach(async () => {
      await cleanProject(projectRoot)
    })

    it("should link external sources", async () => {
      await cmd.action({
        garden,
        args: {
          source: "source-a",
          path: join(projectRoot, "mock-local-path", "source-a"),
        },
        opts: {},
      })

      const { linkedProjectSources } = await garden.localConfigStore.get()

      expect(linkedProjectSources).to.eql([
        { name: "source-a", path: join(projectRoot, "mock-local-path", "source-a") },
      ])
    })

    it("should handle relative paths", async () => {
      await cmd.action({
        garden,
        args: {
          source: "source-a",
          path: join("mock-local-path", "source-a"),
        },
        opts: {},
      })

      const { linkedProjectSources } = await garden.localConfigStore.get()

      expect(linkedProjectSources).to.eql([
        { name: "source-a", path: join(projectRoot, "mock-local-path", "source-a") },
      ])
    })
  })
})
