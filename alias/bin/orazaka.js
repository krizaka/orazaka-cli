#!/usr/bin/env node
"use strict";
/*
 * `orazaka` is the short name of @krizaka/orazaka-cli, so that `npx orazaka …` works. This file runs
 * that CLI's own entry point in this process: argv, stdin/stdout/stderr and the exit code are the
 * CLI's, untouched. Nothing else lives here — every change is made in @krizaka/orazaka-cli.
 */
const path = require("node:path");

const manifest = require.resolve("@krizaka/orazaka-cli/package.json");
const { bin } = require(manifest);
require(path.join(path.dirname(manifest), typeof bin === "string" ? bin : bin.orazaka));
