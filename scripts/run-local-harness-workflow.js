#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const options = {
    agent: process.env.LOCAL_HARNESS_AGENT_NAME || 'waymark-local-harness',
    workspace: process.env.LOCAL_HARNESS_WORKSPACE || '.',
    validationCommand: process.env.LOCAL_HARNESS_VALIDATION_COMMAND || 'python3 -m compileall .',
    maxAttempts: Number(process.env.LOCAL_HARNESS_MAX_ATTEMPTS || '3'),
    baseBranch: process.env.LOCAL_HARNESS_BASE_BRANCH || 'main',
    skipWorkboard: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--task':
        options.task = argv[++i];
        break;
      case '--row':
        options.row = Number(argv[++i]);
        break;
      case '--agent':
        options.agent = argv[++i];
        break;
      case '--workspace':
        options.workspace = argv[++i];
        break;
      case '--validation-command':
        options.validationCommand = argv[++i];
        break;
      case '--max-attempts':
        options.maxAttempts = Number(argv[++i]);
        break;
      case '--base-branch':
        options.baseBranch = argv[++i];
        break;
      case '--skip-workboard':
        options.skipWorkboard = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/run-local-harness-workflow.js [options]\n\n` +
    `Options:\n` +
    `  --task <text>                Task text to hand to the harness\n` +
    `  --row <number>               Task row to claim from the Waymark board\n` +
    `  --agent <name>               Agent name used for workboard updates (default: waymark-local-harness)\n` +
    `  --workspace <path>           Repo/workspace to hand to the harness (default: current directory)\n` +
    `  --validation-command <cmd>   Validation command passed to the harness (default: python3 -m compileall .)\n` +
    `  --max-attempts <n>           Max harness attempts (default: 3)\n` +
    `  --base-branch <name>         Git base branch (default: main)\n` +
    `  --skip-workboard             Skip workboard reads/writes\n` +
    `  --dry-run                    Print the plan without running the harness`);
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: options.stdio || 'pipe',
    env: options.env || process.env,
    shell: false,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').toString().trim();
    const stdout = (result.stdout || '').toString().trim();
    throw new Error(`${command} ${args.join(' ')} failed\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }

  return {
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
  };
}

function sanitizeBranchName(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'task';
}

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getHarnessScriptPath() {
  return process.env.LOCAL_HARNESS_SCRIPT || path.resolve(__dirname, '..', '..', 'ollama', 'scripts', 'code_harness.py');
}

function selectWorkboardTask(options, repoRoot) {
  if (options.skipWorkboard) {
    return null;
  }

  try {
    const output = runCommand('node', ['scripts/check-workboard.js', '--agent', options.agent], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const board = JSON.parse(output.stdout);
    const todos = board.todo || [];
    if (!todos.length) {
      return null;
    }

    const match = options.row ? todos.find((item) => item.row === options.row) : null;
    const task = match || todos[0];
    return {
      row: task.row,
      title: task.task,
      description: task.desc || '',
      project: task.project || '',
      priority: task.priority || '',
      notes: task.notes || [],
    };
  } catch (error) {
    console.warn(`Workboard lookup skipped: ${error.message}`);
    return null;
  }
}

function updateWorkboard(repoRoot, row, agent, command, message) {
  if (!row) {
    return;
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn('Skipping workboard update because GOOGLE_APPLICATION_CREDENTIALS is not set.');
    return;
  }

  try {
    if (command === 'claim') {
      runCommand('node', ['scripts/update-workboard.js', 'claim', String(row), '--agent', agent], { cwd: repoRoot });
    } else if (command === 'note') {
      runCommand('node', ['scripts/update-workboard.js', 'note', String(row), message, '--agent', agent], { cwd: repoRoot });
    } else if (command === 'stage') {
      runCommand('node', ['scripts/update-workboard.js', 'stage', String(row), message, '--agent', agent], { cwd: repoRoot });
    }
  } catch (error) {
    console.warn(`Workboard ${command} update failed: ${error.message}`);
  }
}

function git(repoRoot, args) {
  return runCommand('git', args, { cwd: repoRoot }).stdout.trim();
}

function ensureBranch(repoRoot, options) {
  git(repoRoot, ['checkout', '--', '.']);
  git(repoRoot, ['clean', '-fd']);
  git(repoRoot, ['fetch', 'origin']);

  try {
    git(repoRoot, ['rev-parse', '--verify', `refs/remotes/origin/${options.baseBranch}`]);
  } catch (error) {
    console.warn(`Remote branch origin/${options.baseBranch} not found; falling back to local main.`);
    options.baseBranch = 'main';
  }

  git(repoRoot, ['checkout', options.baseBranch]);
  git(repoRoot, ['reset', '--hard', `origin/${options.baseBranch}`]);

  const branchName = `feature/${sanitizeBranchName(options.taskTitle || 'local-harness-task')}`;
  git(repoRoot, ['checkout', '-b', branchName]);
  return branchName;
}

function collectChangedFiles(repoRoot) {
  try {
    const status = git(repoRoot, ['status', '--short']);
    return status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .slice(0, 20);
  } catch (error) {
    return [];
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const gitRoot = getRepoRoot();
  const workspaceRoot = path.resolve(options.workspace || gitRoot);
  const harnessScript = getHarnessScriptPath();

  if (!fs.existsSync(harnessScript)) {
    throw new Error(`Local harness script not found: ${harnessScript}`);
  }

  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  let task = null;
  let taskRow = null;

  if (options.task) {
    task = {
      title: options.task,
      description: '',
      row: options.row || null,
    };
  } else {
    task = selectWorkboardTask(options, gitRoot);
    taskRow = task ? task.row : null;
    if (!task) {
      throw new Error('No task found. Supply --task or provide a Waymark task in the board.');
    }
  }

  options.taskTitle = task.title;
  const taskText = [task.title, task.description].filter(Boolean).join('\n\n');
  const branchName = options.dryRun ? 'dry-run-branch' : ensureBranch(gitRoot, options);

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      workspace: workspaceRoot,
      repoRoot: gitRoot,
      task: taskText,
      branch: branchName,
      validationCommand: options.validationCommand,
      maxAttempts: options.maxAttempts,
    }, null, 2));
    return;
  }

  if (!options.skipWorkboard && taskRow) {
    updateWorkboard(gitRoot, taskRow, options.agent, 'claim', '');
    updateWorkboard(gitRoot, taskRow, options.agent, 'note', `Starting local harness loop for: ${task.title}`);
  }

  const env = { ...process.env, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434' };
  const harnessArgs = [
    harnessScript,
    '--task', taskText,
    '--workspace', workspaceRoot,
    '--validation-command', options.validationCommand,
    '--max-attempts', String(options.maxAttempts),
  ];

  console.log(`Running local harness for task: ${task.title}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Repo root: ${gitRoot}`);
  console.log(`Branch: ${branchName}`);
  const result = spawnSync('python3', harnessArgs, {
    cwd: workspaceRoot,
    stdio: 'inherit',
    env,
  });

  const changedFiles = collectChangedFiles(gitRoot);
  const summary = changedFiles.length ? changedFiles.join(', ') : 'no files changed';
  const statusText = `Branch: ${branchName} | Files: ${summary}`;

  if (result.status === 0) {
    if (!options.skipWorkboard && taskRow) {
      updateWorkboard(gitRoot, taskRow, options.agent, 'stage', 'QA');
      updateWorkboard(gitRoot, taskRow, options.agent, 'note', `${statusText} | Harness: succeeded`);
    }
    console.log('Harness completed successfully.');
    return;
  }

  if (!options.skipWorkboard && taskRow) {
    updateWorkboard(gitRoot, taskRow, options.agent, 'stage', 'To Do');
    updateWorkboard(gitRoot, taskRow, options.agent, 'note', `${statusText} | Harness: failed (exit ${result.status})`);
  }
  process.exit(result.status || 2);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
