#!/bin/bash -e

garden_cli_root=$(cd `dirname $0` && cd .. && pwd)

cd ${garden_cli_root}

echo "Copying files to tmp build dir..."
mkdir -p dist
mkdir -p tmp/dist

cp -r package.json build static node_modules tmp/dist

echo "Cleaning up .garden directories..."
find tmp/dist -depth -type d -name ".garden" -exec rm -r "{}" \;

echo "Copying static files..."
cp -r tmp/dist/static dist

echo "Building executables..."
cd dist
pkg --target node10-linux-x64,node10-macos-x64,node10-win-x64 ../tmp/dist

echo "Done!"
