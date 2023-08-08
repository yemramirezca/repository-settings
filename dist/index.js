/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 963:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const mergeArrayByName = __nccwpck_require__(909)

/**
 * @param {import('probot').Probot} robot
 */
module.exports = (robot, _, Settings = __nccwpck_require__(31)) => {
  async function syncSettings (context, repo = context.repo()) {
    const config = await context.config('settings.yml', {}, { arrayMerge: mergeArrayByName })
    return Settings.sync(context.octokit, repo, config)
  }

  robot.on('push', async context => {
    const { payload } = context
    const { repository } = payload

    const defaultBranch = payload.ref === 'refs/heads/' + repository.default_branch
    if (!defaultBranch) {
      robot.log.debug('Not working on the default branch, returning...')
      return
    }

    const settingsModified = payload.commits.find(commit => {
      return commit.added.includes(Settings.FILE_NAME) || commit.modified.includes(Settings.FILE_NAME)
    })

    if (!settingsModified) {
      robot.log.debug(`No changes in '${Settings.FILE_NAME}' detected, returning...`)
      return
    }

    return syncSettings(context)
  })

  robot.on('repository.edited', async context => {
    const { payload } = context
    const { changes, repository } = payload

    if (!Object.prototype.hasOwnProperty.call(changes, 'default_branch')) {
      robot.log.debug('Repository configuration was edited but the default branch was not affected, returning...')
      return
    }

    robot.log.debug(`Default branch changed from '${changes.default_branch.from}' to '${repository.default_branch}'`)

    return syncSettings(context)
  })

  robot.on('repository.created', async context => {
    return syncSettings(context)
  })
}


/***/ }),

/***/ 909:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// https://github.com/KyleAMathews/deepmerge#arraymerge

const merge = __nccwpck_require__(719)

function findMatchingIndex (sourceItem, target) {
  if (Object.prototype.hasOwnProperty.call(sourceItem, 'name')) {
    return target
      .filter(targetItem => Object.prototype.hasOwnProperty.call(targetItem, 'name'))
      .findIndex(targetItem => sourceItem.name === targetItem.name)
  }
}

function mergeByName (target, source, options) {
  const destination = target.slice()

  source.forEach(sourceItem => {
    const matchingIndex = findMatchingIndex(sourceItem, target)
    if (matchingIndex > -1) {
      destination[matchingIndex] = merge(target[matchingIndex], sourceItem, options)
    } else {
      destination.push(sourceItem)
    }
  })

  return destination
}

module.exports = mergeByName


/***/ }),

/***/ 515:
/***/ ((module) => {

const previewHeaders = {
  accept:
    'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json'
}

module.exports = class Branches {
  constructor (github, repo, settings) {
    this.github = github
    this.repo = repo
    this.branches = settings
  }

  sync () {
    return Promise.all(
      this.branches
        .filter(branch => branch.protection !== undefined)
        .map(branch => {
          const params = Object.assign(this.repo, { branch: branch.name })

          if (this.isEmpty(branch.protection)) {
            return this.github.repos.deleteBranchProtection(params)
          } else {
            Object.assign(params, branch.protection, { headers: previewHeaders })
            return this.github.repos.updateBranchProtection(params)
          }
        })
    )
  }

  isEmpty (maybeEmpty) {
    return maybeEmpty === null || Object.keys(maybeEmpty).length === 0
  }
}


/***/ }),

/***/ 202:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Diffable = __nccwpck_require__(122)

module.exports = class Collaborators extends Diffable {
  constructor (...args) {
    super(...args)

    if (this.entries) {
      // Force all usernames to lowercase to avoid comparison issues.
      this.entries.forEach(collaborator => {
        collaborator.username = collaborator.username.toLowerCase()
      })
    }
  }

  find () {
    return this.github.repos
      .listCollaborators({ repo: this.repo.repo, owner: this.repo.owner, affiliation: 'direct' })
      .then(res => {
        return res.data.map(user => {
          return {
            // Force all usernames to lowercase to avoid comparison issues.
            username: user.login.toLowerCase(),
            permission:
              (user.permissions.admin && 'admin') ||
              (user.permissions.push && 'push') ||
              (user.permissions.pull && 'pull')
          }
        })
      })
  }

  comparator (existing, attrs) {
    return existing.username === attrs.username
  }

  changed (existing, attrs) {
    return existing.permission !== attrs.permission
  }

  update (existing, attrs) {
    return this.add(attrs)
  }

  add (attrs) {
    return this.github.repos.addCollaborator(Object.assign({}, attrs, this.repo))
  }

  remove (existing) {
    return this.github.repos.removeCollaborator(Object.assign({ username: existing.username }, this.repo))
  }
}


/***/ }),

/***/ 122:
/***/ ((module) => {

// Base class to make it easy to check for changes to a list of items
//
//     class Thing extends Diffable {
//       find() {
//       }
//
//       comparator(existing, attrs) {
//       }
//
//       changed(existing, attrs) {
//       }
//
//       update(existing, attrs) {
//       }
//
//       add(attrs) {
//       }
//
//       remove(existing) {
//       }
//     }
module.exports = class Diffable {
  constructor (github, repo, entries) {
    this.github = github
    this.repo = repo
    this.entries = entries
  }

  sync () {
    if (this.entries) {
      return this.find().then(existingRecords => {
        const changes = []

        this.entries.forEach(attrs => {
          const existing = existingRecords.find(record => {
            return this.comparator(record, attrs)
          })

          if (!existing) {
            changes.push(this.add(attrs))
          } else if (this.changed(existing, attrs)) {
            changes.push(this.update(existing, attrs))
          }
        })

        existingRecords.forEach(x => {
          if (!this.entries.find(y => this.comparator(x, y))) {
            changes.push(this.remove(x))
          }
        })

        return Promise.all(changes)
      })
    }
  }
}


/***/ }),

/***/ 769:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Diffable = __nccwpck_require__(122)

const environmentRepoEndpoint = '/repos/:org/:repo/environments/:environment_name'

module.exports = class Environments extends Diffable {
  constructor (...args) {
    super(...args)

    if (this.entries) {
      // Force all names to lowercase to avoid comparison issues.
      this.entries.forEach(environment => {
        environment.name = environment.name.toLowerCase()
      })
    }
  }

  async find () {
    const {
      data: { environments }
    } = await this.github.request('GET /repos/:org/:repo/environments', {
      org: this.repo.owner,
      repo: this.repo.repo
    })
    return Promise.all(
      environments.map(async environment => {
        if (environment.deployment_branch_policy) {
          if (environment.deployment_branch_policy.custom_branch_policies) {
            const branchPolicies = await this.getDeploymentBranchPolicies(
              this.repo.owner,
              this.repo.repo,
              environment.name
            )
            environment.deployment_branch_policy = {
              custom_branches: branchPolicies.map(_ => _.name)
            }
          } else {
            environment.deployment_branch_policy = {
              protected_branches: true
            }
          }
        }
        return {
          ...environment,
          // Force all names to lowercase to avoid comparison issues.
          name: environment.name.toLowerCase()
        }
      })
    )
  }

  comparator (existing, attrs) {
    return existing.name === attrs.name
  }

  changed (existing, attrs) {
    if (!attrs.wait_timer) attrs.wait_timer = 0
    return (
      (existing.wait_timer || 0) !== attrs.wait_timer ||
      this.reviewersToString(existing.reviewers) !== this.reviewersToString(attrs.reviewers) ||
      this.deploymentBranchPolicyToString(existing.deployment_branch_policy) !==
        this.deploymentBranchPolicyToString(attrs.deployment_branch_policy)
    )
  }

  async update (existing, attrs) {
    if (existing.deployment_branch_policy && existing.deployment_branch_policy.custom_branches) {
      const branchPolicies = await this.getDeploymentBranchPolicies(this.repo.owner, this.repo.repo, existing.name)
      await Promise.all(
        branchPolicies.map(branchPolicy =>
          this.github.request(
            'DELETE /repos/:org/:repo/environments/:environment_name/deployment-branch-policies/:id',
            {
              org: this.repo.owner,
              repo: this.repo.repo,
              environment_name: existing.name,
              id: branchPolicy.id
            }
          )
        )
      )
    }
    return this.add(attrs)
  }

  async add (attrs) {
    await this.github.request(`PUT ${environmentRepoEndpoint}`, this.toParams({ name: attrs.name }, attrs))
    if (attrs.deployment_branch_policy && attrs.deployment_branch_policy.custom_branches) {
      await Promise.all(
        attrs.deployment_branch_policy.custom_branches.map(name =>
          this.github.request(`POST /repos/:org/:repo/environments/:environment_name/deployment-branch-policies`, {
            org: this.repo.owner,
            repo: this.repo.repo,
            environment_name: attrs.name,
            name
          })
        )
      )
    }
  }

  remove (existing) {
    return this.github.request(`DELETE ${environmentRepoEndpoint}`, {
      environment_name: existing.name,
      repo: this.repo.repo,
      org: this.repo.owner
    })
  }

  reviewersToString (attrs) {
    if (attrs === null || attrs === undefined) {
      return ''
    } else {
      attrs.sort((a, b) => {
        if (a.id < b.id) return -1
        if (a.id > b.id) return 1
        if (a.type < b.type) return -1
        if (a.type > b.type) return 1
        return 0
      })
      return JSON.stringify(
        attrs.map(reviewer => {
          return {
            id: reviewer.id,
            type: reviewer.type
          }
        })
      )
    }
  }

  deploymentBranchPolicyToString (attrs) {
    if (attrs === null || attrs === undefined) {
      return ''
    } else {
      return JSON.stringify(
        this.shouldUseProtectedBranches(attrs.protected_branches, attrs.custom_branches)
          ? { protected_branches: true }
          : { custom_branches: attrs.custom_branches.sort() }
      )
    }
  }

  async getDeploymentBranchPolicies (owner, repo, environmentName) {
    const {
      data: { branch_policies: branchPolicies }
    } = await this.github.request('GET /repos/:org/:repo/environments/:environment_name/deployment-branch-policies', {
      org: owner,
      repo,
      environment_name: environmentName
    })
    return branchPolicies
  }

  toParams (existing, attrs) {
    const deploymentBranchPolicy = attrs.deployment_branch_policy
      ? this.shouldUseProtectedBranches(
          attrs.deployment_branch_policy.protected_branches,
          attrs.deployment_branch_policy.custom_branches
        )
        ? { protected_branches: true, custom_branch_policies: false }
        : { protected_branches: false, custom_branch_policies: true }
      : null
    return {
      environment_name: existing.name,
      repo: this.repo.repo,
      org: this.repo.owner,
      wait_timer: attrs.wait_timer,
      reviewers: attrs.reviewers,
      deployment_branch_policy: deploymentBranchPolicy
    }
  }

  shouldUseProtectedBranches (protectedBranches, customBranchPolicies) {
    if (protectedBranches || customBranchPolicies === undefined || customBranchPolicies === null) {
      return true // Returning booleans like this to avoid unexpected datatypes that result in truthy values
    } else {
      return false
    }
  }
}


/***/ }),

/***/ 224:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Diffable = __nccwpck_require__(122)
const previewHeaders = { accept: 'application/vnd.github.symmetra-preview+json' }

module.exports = class Labels extends Diffable {
  constructor (...args) {
    super(...args)

    if (this.entries) {
      this.entries.forEach(label => {
        // Force color to string since some hex colors can be numerical (e.g. 999999)
        if (label.color) {
          label.color = String(label.color).replace(/^#/, '')
          if (label.color.length < 6) {
            label.color = label.color.padStart(6, '0')
          }
        }
      })
    }
  }

  find () {
    const options = this.github.issues.listLabelsForRepo.endpoint.merge(this.wrapAttrs({ per_page: 100 }))
    return this.github.paginate(options)
  }

  comparator (existing, attrs) {
    return existing.name === attrs.name
  }

  changed (existing, attrs) {
    return 'new_name' in attrs || existing.color !== attrs.color || existing.description !== attrs.description
  }

  update (existing, attrs) {
    return this.github.issues.updateLabel(this.wrapAttrs(attrs))
  }

  add (attrs) {
    return this.github.issues.createLabel(this.wrapAttrs(attrs))
  }

  remove (existing) {
    return this.github.issues.deleteLabel(this.wrapAttrs({ name: existing.name }))
  }

  wrapAttrs (attrs) {
    return Object.assign({}, attrs, this.repo, { headers: previewHeaders })
  }
}


/***/ }),

/***/ 296:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Diffable = __nccwpck_require__(122)

module.exports = class Milestones extends Diffable {
  constructor (...args) {
    super(...args)

    if (this.entries) {
      this.entries.forEach(milestone => {
        if (milestone.due_on) {
          delete milestone.due_on
        }
      })
    }
  }

  find () {
    const options = this.github.issues.listMilestones.endpoint.merge(
      Object.assign({ per_page: 100, state: 'all' }, this.repo)
    )
    return this.github.paginate(options)
  }

  comparator (existing, attrs) {
    return existing.title === attrs.title
  }

  changed (existing, attrs) {
    return existing.description !== attrs.description || existing.state !== attrs.state
  }

  update (existing, attrs) {
    const { owner, repo } = this.repo

    return this.github.issues.updateMilestone(
      Object.assign({ milestone_number: existing.number }, attrs, { owner, repo })
    )
  }

  add (attrs) {
    const { owner, repo } = this.repo

    return this.github.issues.createMilestone(Object.assign({}, attrs, { owner, repo }))
  }

  remove (existing) {
    const { owner, repo } = this.repo

    return this.github.issues.deleteMilestone(Object.assign({ milestone_number: existing.number }, { owner, repo }))
  }
}


/***/ }),

/***/ 771:
/***/ ((module) => {

const enableAutomatedSecurityFixes = ({ github, settings, enabled }) => {
  if (enabled === undefined) {
    return Promise.resolve()
  }

  const args = {
    owner: settings.owner,
    repo: settings.repo,
    mediaType: {
      previews: ['london']
    }
  }
  const methodName = enabled ? 'enableAutomatedSecurityFixes' : 'disableAutomatedSecurityFixes'

  return github.repos[methodName](args)
}

const enableVulnerabilityAlerts = ({ github, settings, enabled }) => {
  if (enabled === undefined) {
    return Promise.resolve()
  }

  const args = {
    owner: settings.owner,
    repo: settings.repo,
    mediaType: {
      previews: ['dorian']
    }
  }
  const methodName = enabled ? 'enableVulnerabilityAlerts' : 'disableVulnerabilityAlerts'

  return github.repos[methodName](args)
}

module.exports = class Repository {
  constructor (github, repo, settings) {
    this.github = github
    this.settings = Object.assign({ mediaType: { previews: ['baptiste'] } }, settings, repo)
    this.topics = this.settings.topics
    delete this.settings.topics

    this.enableVulnerabilityAlerts = this.settings.enable_vulnerability_alerts
    delete this.settings.enable_vulnerability_alerts

    this.enableAutomatedSecurityFixes = this.settings.enable_automated_security_fixes
    delete this.settings.enable_automated_security_fixes
  }

  sync () {
    this.settings.name = this.settings.name || this.settings.repo
    return this.github.repos
      .update(this.settings)
      .then(() => {
        if (this.topics) {
          return this.github.repos.replaceAllTopics({
            owner: this.settings.owner,
            repo: this.settings.repo,
            names: this.topics.split(/\s*,\s*/),
            mediaType: {
              previews: ['mercy']
            }
          })
        }
      })
      .then(() => enableVulnerabilityAlerts({ enabled: this.enableVulnerabilityAlerts, ...this }))
      .then(() => enableAutomatedSecurityFixes({ enabled: this.enableAutomatedSecurityFixes, ...this }))
  }
}


/***/ }),

/***/ 695:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Diffable = __nccwpck_require__(122)

// it is necessary to use this endpoint until GitHub Enterprise supports
// the modern version under /orgs
const teamRepoEndpoint = '/teams/:team_id/repos/:owner/:repo'

module.exports = class Teams extends Diffable {
  find () {
    return this.github.repos.listTeams(this.repo).then(res => res.data)
  }

  comparator (existing, attrs) {
    return existing.slug === attrs.name
  }

  changed (existing, attrs) {
    return existing.permission !== attrs.permission
  }

  update (existing, attrs) {
    return this.github.request(`PUT ${teamRepoEndpoint}`, this.toParams(existing, attrs))
  }

  async add (attrs) {
    const { data: existing } = await this.github.request('GET /orgs/:org/teams/:team_slug', {
      org: this.repo.owner,
      team_slug: attrs.name
    })

    return this.github.request(`PUT ${teamRepoEndpoint}`, this.toParams(existing, attrs))
  }

  remove (existing) {
    return this.github.request(`DELETE ${teamRepoEndpoint}`, {
      team_id: existing.id,
      ...this.repo,
      org: this.repo.owner
    })
  }

  toParams (existing, attrs) {
    return {
      team_id: existing.id,
      owner: this.repo.owner,
      repo: this.repo.repo,
      org: this.repo.owner,
      permission: attrs.permission
    }
  }
}


/***/ }),

/***/ 31:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

class Settings {
  static sync (github, repo, config) {
    return new Settings(github, repo, config).update()
  }

  constructor (github, repo, config) {
    this.github = github
    this.repo = repo
    this.config = config
  }

  update () {
    const { branches, ...rest } = this.config

    return Promise.all(
      Object.entries(rest).map(([section, config]) => {
        return this.processSection(section, config)
      })
    ).then(() => {
      if (branches) {
        return this.processSection('branches', branches)
      }
    })
  }

  processSection (section, config) {
    const debug = { repo: this.repo }
    debug[section] = config

    const Plugin = Settings.PLUGINS[section]
    return new Plugin(this.github, this.repo, config).sync()
  }
}

Settings.FILE_NAME = '.github/settings.yml'

Settings.PLUGINS = {
  repository: __nccwpck_require__(771),
  labels: __nccwpck_require__(224),
  collaborators: __nccwpck_require__(202),
  environments: __nccwpck_require__(769),
  teams: __nccwpck_require__(695),
  milestones: __nccwpck_require__(296),
  branches: __nccwpck_require__(515)
}

module.exports = Settings


/***/ }),

/***/ 719:
/***/ ((module) => {

module.exports = eval("require")("deepmerge");


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(963);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;