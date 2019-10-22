import {
  existsSync,
  readFileSync,
  Stats,
} from 'fs';
import {
  join,
  resolve,
  sep,
  basename,
  extname,
  dirname,
} from 'path';
import readdir from 'recursive-readdir';
import Config from './config';

const cwd: string = process.cwd();

export const getEngine = (): 'jsx' | 'tsx' => existsSync(join(cwd, 'tsconfig.json')) ? 'tsx' : 'jsx';

export const hasUserBabelrc = (): boolean => {
  return existsSync(join(cwd, '.babelrc')) || existsSync(join(cwd, '.babelrc.js')) || existsSync(join(cwd, 'babel.config.js'));
};

export const getBabelrc = (): string => {
  if (existsSync(join(cwd, '.babelrc'))) return join(cwd, '.babelrc');
  if (existsSync(join(cwd, '.babelrc.js'))) return join(cwd, '.babelrc.js');
  if (existsSync(join(cwd, 'babel.config.js'))) return join(cwd, 'babel.config.js');
  return resolve(__dirname, '../babel.config.default.js');
};

export const getBabelRule = () => {
  return {
    test: /\.(js|ts)x?$/,
    exclude: /node_modules/,
    use: {
      loader: 'babel-loader',
      options: {
        cacheDirectory: true,
        extends: getBabelrc(),
      },
    },
  };
};

export const gracefullyShutDown = async (getPort: () => number) => {
  let run = false;
  const wrapper = () => {
    if (!run) {
      run = true;
      const resolve = require('resolve-as-bin');
      const spawn = require('cross-spawn');
      const port = getPort();
      spawn.sync(resolve('fkill'), ['-f', `:${port}`], {
        cwd,
        stdio: 'inherit',
      });
    }
  };
  process.on('SIGINT', wrapper);
  process.on('SIGTERM', wrapper);
  process.on('exit', wrapper);
};

const ignores = [
  '.*',
  '*.json',
  '*.lock',
  '*.md',
  '*.txt',
  '*.yml',
  'LICENSE',
];

const ignoreDotDir = (file: string, stats: Stats) => {
  return stats.isDirectory() && basename(file).startsWith('.');
};

const ignoreNodeModules = (file: string, stats: Stats) => {
  return stats.isDirectory() && basename(file) == 'node_modules';
};

export const getPages = async (config: Config): Promise<string[][]> => {
  const allPages = await readdir(cwd, [ignoreNodeModules, ignoreDotDir, ...ignores]);
  const entryPages = await readdir(join(cwd, config.viewsDir), [ignoreDotDir, ...ignores]);
  const otherPages = [];
  for (let i = 0; i < allPages.length; i++) {
    const p = allPages[i];
    if (entryPages.includes(p)) {
      continue;
    }
    otherPages.push(p);
  }
  return [entryPages, otherPages];
};

export const getPageId = (page: string, config: Config, separator: string = '_'): string => {
  const [, ...rest] = page.replace(join(cwd, config.viewsDir), '')
                          .replace(extname(page), '')
                          .split(sep);
  return rest.join(separator);
};

export const readFileWithProps = (file: string, props: any) => {
  return readFileSync(file).toString().replace('__REACT_SSR_PROPS__', JSON.stringify(props).replace(/"/g, '\\"'));
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getBabelPresetsAndPlugins = () => {
  const presets = [
    require('@babel/preset-env'),
    require('@babel/preset-react'),
    require('@babel/preset-typescript'),
  ];
  const plugins = [
    require('babel-plugin-react-require'),
    require('babel-plugin-css-modules-transform'),
    require('@babel/plugin-syntax-dynamic-import'),
    require('@babel/plugin-proposal-class-properties'),
    [require('@babel/plugin-proposal-object-rest-spread'), {
      useBuiltIns: true,
    }],
    require('@babel/plugin-transform-react-jsx'),
    [require('@babel/plugin-transform-runtime'), {
      corejs: 2,
      helpers: true,
      regenerator: true,
      useESModules: false,
    }],
  ];
  return { presets, plugins };
};

const Module = require('module');

const originalRequire = Module.prototype.require;

const requireFromString = (code: string, filename?: string) => {
  const f = filename || '';
  const p = module.parent;
  const m = new Module(f, p);
  m.filename = f;
  m.paths = Module._nodeModulePaths(dirname(f));
  m._compile(code, f);
  const _exports = m.exports;
  p && p.children && p.children.splice(p.children.indexOf(m), 1);
  return _exports;
}

export function babelRequire(filename: string) {
  const rawCode: string = readFileSync(filename).toString();

  const result = require("@babel/core").transform(rawCode, {
    filename,
    ...(getBabelPresetsAndPlugins()),
  });

  // console.log(code);
  Module.prototype.require = function() {
    // console.log(arguments);
    // const aPath = getFullPath(arguments[0], getCallerFile());

    // const hoge = isInNodePath(aPath);

    if (!module.parent) {
      return originalRequire.apply(this, arguments);
    }

    let p;
    const localModuleName = join(dirname(module.parent.filename), arguments[0]);
    try {
      p = Module._resolveFilename(localModuleName);
    } catch (e) {
      if (isModuleNotFoundError(e)) {
        p = localModuleName;
      } else {
        throw e;
      }
    }

    console.log(p);

    // console.log(getCallerFile());

    // const isLocalModule = /^\.{1,2}[/\\]?/.test(p);

    // console.log(isLocalModule, p);

    return originalRequire.apply(this, arguments);
  };

  return requireFromString(result.code);

  // Module.prototype.require = function() {
  //   return babelRequire.apply(this, arguments as any);
  // };
  // try {
  //   return requireFromString(result.code);
  // } finally {
  //   Module.prototype.require = function() {
  //     return originalRequire.apply(this, arguments);
  //   };
  // }
};














const getCallerFile = require('get-caller-file');
const normalize = require('normalize-path');

function isInNodePath(resolvedPath?: string) {
  if (!resolvedPath) return false;

  return Module.globalPaths
    .map((nodePath: string) => {
      return resolve(process.cwd(), nodePath) + sep;
    })
    .some((fullNodePath: string) => {
      return resolvedPath.indexOf(fullNodePath) === 0;
    });
}

function getFullPath(path: string, calledFrom: string) {
  let resolvedPath: string | undefined = undefined;
  try {
    resolvedPath = require.resolve(path);
  } catch (e) {
    // do nothing
  }

  const isLocalModule = /^\.{1,2}[/\\]?/.test(path);
  const isInPath = isInNodePath(resolvedPath);
  const isExternal = !isLocalModule && /[/\\]node_modules[/\\]/.test(resolvedPath || '');
  const isSystemModule = resolvedPath === path;

  if (isExternal || isSystemModule || isInPath) {
    return resolvedPath;
  }

  if (!isLocalModule) {
    return path;
  }

  const localModuleName = join(dirname(calledFrom), path);
  try {
    return Module._resolveFilename(localModuleName);
  } catch (e) {
    if (isModuleNotFoundError(e)) { return localModuleName; } else { throw e; }
  }
}

function getFullPathNormalized(path: string, calledFrom: string) {
  return normalize(getFullPath(path, calledFrom));
}

function isModuleNotFoundError(e: any) {
  return e.code && e.code === 'MODULE_NOT_FOUND';
}