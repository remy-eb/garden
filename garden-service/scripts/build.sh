#!/bin/bash -e

garden_service_root=$(cd `dirname $0` && cd .. && pwd)

cd ${garden_service_root}

git submodule update --remote

cd vendor/github.com/garden-io/javascript/node-client
npm install
npm run build

cd ${garden_service_root}
npm install vendor/github.com/garden-io/javascript/node-client
npm install
npm run clean
gulp build
