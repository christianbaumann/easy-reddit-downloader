const request = require('request');
const { version } = require('./package.json');

// NodeJS Dependencies
const fs = require('fs');
const prompts = require('prompts');
const chalk = require('chalk');
const axios = require('axios');

const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');

let config = require('./user_config_DEFAULT.json');

// Variables used for logging
let userLogs = '';
const logFormat = 'txt';
let date = new Date();
let date_string = `${date.getFullYear()} ${
    date.getMonth() + 1
} ${date.getDate()} at ${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
let startTime = null;
let lastAPICallForSubreddit = false;
let currentAPICall = null;

let currentSubredditIndex = 0; // Used to track which subreddit the user is downloading from
let responseSize = -1; // Used to track the size of the response from the API call, aka how many posts are in the response

// User-defined variables, these can be preset with the help of testingMode
let timeBetweenRuns = 0; // in milliseconds, the time between runs. This is only used if repeatForever is true
let subredditList = []; // List of subreddits in this format: ['subreddit1', 'subreddit2', 'subreddit3']
let numberOfPosts = -1; // How many posts to go through, more posts = more downloads, but takes longer
let sorting = 'top'; // How to sort the posts (top, new, hot, rising, controversial)
let time = 'all'; // What time period to sort by (hour, day, week, month, year, all)
let repeatForever = false; // If true, the program will repeat every timeBetweenRuns milliseconds
let downloadDirectory = ''; // Where to download the files to, defined when
let downloadDirectoryBase = './downloads'; // Default download path, can be overridden
const postDelayMilliseconds = 250;

let currentUserAfter = ''; // Used to track the after value for the API call, this is used to get the next X posts

// --- RedGIFs support ---
const REDGIFS_API_BASE = 'https://api.redgifs.com/v2';
let redgifsToken = null;
let redgifsTokenFetchedAt = 0;
const REDGIFS_TOKEN_TTL_MS = 25 * 60 * 1000; // refresh every ~25 minutes to be safe

// Default object to track the downloaded posts by type,
// and the subreddit downloading from.
let downloadedPosts = {
    subreddit: '',
    self: 0,
    media: 0,
    link: 0,
    failed: 0,
    skipped_due_to_duplicate: 0,
    skipped_due_to_fileType: 0,
};

// Read the user_config.json file for user configuration options
if (fs.existsSync('./user_config.json')) {
    config = require('./user_config.json');
    checkConfig();
} else {
    // create ./user_config.json if it doesn't exist, by duplicating user_config_DEFAULT.json and renaming it
    fs.copyFile('./user_config_DEFAULT.json', './user_config.json', (err) => {
        if (err) throw err;
        log('user_config.json was created. Edit it to manage user options.', true);
        config = require('./user_config.json');
    });
    checkConfig();
}

// check if download_post_list.txt exists, if it doesn't, create it
if (!fs.existsSync('./download_post_list.txt')) {
    fs.writeFile('./download_post_list.txt', '', (err) => {
        if (err) throw err;

        let fileDefaultContent = `# Below, please list any posts that you wish to download. # \n# They must follow this format below: # \n# https://www.reddit.com/r/gadgets/comments/ptt967/eu_proposes_mandatory_usbc_on_all_devices/ # \n# Lines with "#" at the start will be ignored (treated as comments). #`;

        // write a few lines to the file
        fs.appendFile('./download_post_list.txt', fileDefaultContent, (err) => {
            if (err) throw err;
            log('download_post_list.txt was created with default content.', true);
        });
    });
}

// Testing Mode for developer testing. This enables you to hardcode
// the variables above and skip the prompt.
// To edit, go into the user_config.json file.
const testingMode = config.testingMode;
if (testingMode) {
    subredditList = config.testingModeOptions.subredditList;
    numberOfPosts = config.testingModeOptions.numberOfPosts;
    sorting = config.testingModeOptions.sorting;
    time = config.testingModeOptions.time;
    repeatForever = config.testingModeOptions.repeatForever;
    timeBetweenRuns = config.testingModeOptions.timeBetweenRuns;
    if (config.testingModeOptions.downloadDirectory) {
        downloadDirectoryBase = config.testingModeOptions.downloadDirectory;
    }
}

// Start actions
console.clear(); // Clear the console
log(
    chalk.cyan(
        '👋 Welcome to the easiest & most customizable Reddit Post Downloader!',
    ),
    false,
);
log(
    chalk.yellow(
        '😎 Contribute @ https://github.com/josephrcox/easy-reddit-downloader',
    ),
    false,
);
log(
    chalk.blue(
        '🤔 Confused? Check out the README @ https://github.com/josephrcox/easy-reddit-downloader#readme\n',
    ),
    false,
);
// For debugging logs
log('User config: ' + JSON.stringify(config), true);
if (config.testingMode) {
    log('Testing mode options: ' + JSON.stringify(config.testingMode), true);
}

function checkConfig() {
    let warnTheUser = false;
    let quitApplicaton = false;

    let count =
        (config.file_naming_scheme.showDate === true) +
        (config.file_naming_scheme.showAuthor === true) +
        (config.file_naming_scheme.showTitle === true);
    if (count === 0) {
        quitApplicaton = true;
    } else if (count < 2) {
        warnTheUser = true;
    }

    if (warnTheUser) {
        log(
            chalk.red(
                'WARNING: Your file naming scheme (user_config.json) is poorly set, we recommend changing it.',
            ),
            false,
        );
    }

    if (quitApplicaton) {
        log(
            chalk.red(
                'ALERT: Your file naming scheme (user_config.json) does not have any options set. You can not download posts without filenames. Aborting. ',
            ),
            false,
        );
        process.exit(1);
    }

    if (quitApplicaton || warnTheUser) {
        log(
            chalk.red(
                'Read about recommended naming schemes here - https://github.com/josephrcox/easy-reddit-downloader/blob/main/README.md#File-naming-scheme',
            ),
            false,
        );
    }
}

// Make a GET request to the GitHub API to get the latest release
request.get(
    'https://api.github.com/repos/josephrcox/easy-reddit-downloader/releases/latest',
    { headers: { 'User-Agent': 'Downloader' } },
    (error, response, body) => {
        if (error) {
            log(error, true);
        } else {
            const latestRelease = JSON.parse(body);
            const latestVersion = latestRelease.tag_name;

            if (version !== latestVersion) {
                log(
                    `Hey! A new version (${latestVersion}) is available. \nConsider updating to the latest version with 'git pull'.\n`,
                    false,
                );
                startScript();
            } else {
                log('You are on the latest stable version (' + version + ')\n', true);
                startScript();
            }
        }
    },
);

function startScript() {
    if (!testingMode && !config.download_post_list_options.enabled) {
        startPrompt();
    } else {
        if (config.download_post_list_options.enabled) {
            downloadFromPostListFile();
        } else {
            downloadSubredditPosts(subredditList[0], ''); // skip the prompt and get right to the API calls
        }
    }
}

async function startPrompt() {
    const questions = [
        {
            type: 'text',
            name: 'subreddit',
            message:
                'Which subreddits or users would you like to download? You may submit multiple separated by commas (no spaces).',
            validate: (value) =>
                value.length < 1 ? `Please enter at least one subreddit or user` : true,
        },
        {
            type: 'number',
            name: 'numberOfPosts',
            message:
                'How many posts would you like to attempt to download? If you would like to download all posts, enter 0.',
            initial: 0,
            validate: (value) =>
                !isNaN(value) ? true : `Please enter a number`,
        },
        {
            type: 'text',
            name: 'sorting',
            message:
                'How would you like to sort? (top, new, hot, rising, controversial)',
            initial: 'top',
            validate: (value) =>
                value.toLowerCase() === 'top' ||
                value.toLowerCase() === 'new' ||
                value.toLowerCase() === 'hot' ||
                value.toLowerCase() === 'rising' ||
                value.toLowerCase() === 'controversial'
                    ? true
                    : `Please enter a valid sorting method`,
        },
        {
            type: 'text',
            name: 'time',
            message: 'During what time period? (hour, day, week, month, year, all)',
            initial: 'month',
            validate: (value) =>
                value.toLowerCase() === 'hour' ||
                value.toLowerCase() === 'day' ||
                value.toLowerCase() === 'week' ||
                value.toLowerCase() === 'month' ||
                value.toLowerCase() === 'year' ||
                value.toLowerCase() === 'all'
                    ? true
                    : `Please enter a valid time period`,
        },
        {
            type: 'toggle',
            name: 'repeatForever',
            message: 'Would you like to run this on repeat?',
            initial: false,
            active: 'yes',
            inactive: 'no',
        },
        {
            type: (prev) => (prev == true ? 'number' : null),
            name: 'timeBetweenRuns',
            message: 'How often would you like to run this? (in ms)',
        },
        {
            type: 'text',
            name: 'downloadDirectory',
            message: 'Change the download path, defaults to ./downloads',
            initial: '',
        },
    ];

    const result = await prompts(questions);
    subredditList = result.subreddit.split(',');
    repeatForever = result.repeatForever;
    numberOfPosts = result.numberOfPosts;
    sorting = result.sorting.replace(/\s/g, '');
    time = result.time.replace(/\s/g, '');
    if (result.downloadDirectory) {
        downloadDirectoryBase = result.downloadDirectory;
    }

    for (let i = 0; i < subredditList.length; i++) {
        subredditList[i] = subredditList[i].replace(/\s/g, '');
    }

    if (numberOfPosts === 0) {
        numberOfPosts = 9999999999999999999999;
    }

    if (repeatForever) {
        if (result.repeat < 0) {
            result.repeat = 0;
        }
        timeBetweenRuns = result.timeBetweenRuns;
    }

    startTime = new Date();
    downloadSubredditPosts(subredditList[0], '');
}

function makeDirectories() {
    if (!fs.existsSync(downloadDirectoryBase)) {
        fs.mkdirSync(downloadDirectoryBase);
    }
    if (config.separate_clean_nsfw) {
        if (!fs.existsSync(downloadDirectoryBase + '/clean')) {
            fs.mkdirSync(downloadDirectoryBase + '/clean');
        }
        if (!fs.existsSync(downloadDirectoryBase + '/nsfw')) {
            fs.mkdirSync(downloadDirectoryBase + '/nsfw');
        }
    }
}

async function downloadSubredditPosts(subreddit, lastPostId) {
    let isUser = false;
    if (
        subreddit.includes('u/') ||
        subreddit.includes('user/') ||
        subreddit.includes('/u/')
    ) {
        isUser = true;
        subreddit = subreddit.split('u/').pop();
        return downloadUser(subreddit, lastPostId);
    }
    let postsRemaining = numberOfPostsRemaining()[0];
    if (postsRemaining <= 0) {
        if (subredditList.length > 1) {
            return downloadNextSubreddit();
        } else {
            return checkIfDone('', true);
        }
    } else if (postsRemaining > 100) {
        postsRemaining = 100;
    }

    if (lastPostId == undefined) {
        lastPostId = '';
    }
    makeDirectories();

    try {
        if (subreddit == undefined) {
            if (subredditList.length > 1) {
                return downloadNextSubreddit();
            } else {
                return checkIfDone();
            }
        }

        if (isUser) {
            log(
                `\n\n👀 Requesting posts from
                https://www.reddit.com/user/${subreddit.replace(
                    'u/',
                    '',
                )}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${postsRemaining}&after=${lastPostId}\n`,
                true,
            );
        } else {
            log(
                `\n\n👀 Requesting posts from
            https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${postsRemaining}&after=${lastPostId}\n`,
                true,
            );
        }

        let response = null;
        let data = null;

        try {
            response = await axios.get(
                `https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${postsRemaining}&after=${lastPostId}`,
            );

            data = await response.data;

            currentAPICall = data;
            if (data.message == 'Not Found' || data.data.children.length == 0) {
                throw error;
            }
            if (data.data.children.length < postsRemaining) {
                lastAPICallForSubreddit = true;
                postsRemaining = data.data.children.length;
            } else {
                lastAPICallForSubreddit = false;
            }
        } catch (err) {
            log(
                `\n\nERROR: There was a problem fetching posts for ${subreddit}. This is likely because the subreddit is private, banned, or doesn't exist.`,
                true,
            );
            if (subredditList.length > 1) {
                if (currentSubredditIndex > subredditList.length - 1) {
                    currentSubredditIndex = -1;
                }
                currentSubredditIndex += 1;
                return downloadSubredditPosts(subredditList[currentSubredditIndex], '');
            } else {
                return checkIfDone('', true);
            }
        }

        let isOver18 = data.data.children[0].data.over_18 ? 'nsfw' : 'clean';
        downloadedPosts.subreddit = data.data.children[0].data.subreddit;

        if (!config.separate_clean_nsfw) {
            downloadDirectory =
                downloadDirectoryBase + `/${data.data.children[0].data.subreddit}`;
        } else {
            downloadDirectory =
                downloadDirectoryBase +
                `/${isOver18}/${data.data.children[0].data.subreddit}`;
        }

        if (!fs.existsSync(downloadDirectory)) {
            fs.mkdirSync(downloadDirectory);
        }

        responseSize = data.data.children.length;

        for (const child of data.data.children) {
            await sleep();
            try {
                const post = child.data;
                await downloadPost(post);
            } catch (e) {
                log(e, true);
            }
        }
    } catch (error) {
        throw error;
    }
}

async function downloadUser(user, currentUserAfter) {
    let lastPostId = currentUserAfter;
    let postsRemaining = numberOfPostsRemaining()[0];
    if (postsRemaining <= 0) {
        if (subredditList.length > 1) {
            return downloadNextSubreddit();
        } else {
            return checkIfDone('', true);
        }
    } else if (postsRemaining > 100) {
        postsRemaining = 100;
    }

    if (lastPostId == undefined) {
        lastPostId = '';
    }
    makeDirectories();

    try {
        if (user == undefined) {
            if (subredditList.length > 1) {
                return downloadNextSubreddit();
            } else {
                return checkIfDone();
            }
        }

        let reqUrl = `https://www.reddit.com/user/${user.replace(
            'u/',
            '',
        )}/submitted/.json?limit=${postsRemaining}&after=${lastPostId}`;
        log(
            `\n\n👀 Requesting posts from
            ${reqUrl}\n`,
            false,
        );

        let response = null;
        let data = null;

        try {
            response = await axios.get(`${reqUrl}`);

            data = await response.data;
            currentUserAfter = data.data.after;

            currentAPICall = data;
            if (data.message == 'Not Found' || data.data.children.length == 0) {
                throw error;
            }
            if (data.data.children.length < postsRemaining) {
                lastAPICallForSubreddit = true;
                postsRemaining = data.data.children.length;
            } else {
                lastAPICallForSubreddit = false;
            }
        } catch (err) {
            log(
                `\n\nERROR: There was a problem fetching posts for ${user}. This is likely because the subreddit is private, banned, or doesn't exist.`,
                true,
            );
            if (subredditList.length > 1) {
                if (currentSubredditIndex > subredditList.length - 1) {
                    currentSubredditIndex = -1;
                }
                currentSubredditIndex += 1;
                return downloadSubredditPosts(subredditList[currentSubredditIndex], '');
            } else {
                return checkIfDone('', true);
            }
        }

        downloadDirectory =
            downloadDirectoryBase + `/user_${user.replace('u/', '')}`;

        if (!fs.existsSync(downloadDirectory)) {
            fs.mkdirSync(downloadDirectory);
        }

        responseSize = data.data.children.length;

        for (const child of data.data.children) {
            await sleep();
            try {
                const post = child.data;
                await downloadPost(post);
            } catch (e) {
                log(e, true);
            }
        }
    } catch (error) {
        throw error;
    }
}

async function downloadFromPostListFile() {
    // read file
    let file = fs.readFileSync('./download_post_list.txt', 'utf8');
    let lines = file.split('\n');
    lines = lines.filter((line) => !line.startsWith('#'));
    lines = lines.filter((line) => line != '');
    lines = lines.filter((line) => line.trim() != '');
    lines = lines.filter((line) => line.startsWith('https://www.reddit.com'));
    lines = lines.filter((line) => line.includes('/comments/'));
    numberOfPosts = lines.length;

    repeatForever = config.download_post_list_options.repeatForever;
    timeBetweenRuns = config.download_post_list_options.timeBetweenRuns;

    if (numberOfPosts === 0) {
        log(
            chalk.red(
                'ERROR: There are no posts in the download_post_list.txt file. Please add some posts to the file and try again.\n',
            ),
            false,
        );
        log(
            chalk.yellow(
                'If you are trying to download posts from a subreddit, please set "download_post_list_options.enabled" to false in the user_config.json file.\n',
            ),
            false,
        );
        process.exit(1);
    }

    log(
        chalk.green(
            `Starting download of ${numberOfPosts} posts from the download_post_list.txt file.\n`,
        ),
    );
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const reqUrl = line + '.json';
        axios.get(reqUrl).then(async (response) => {
            const post = response.data[0].data.children[0].data;
            let isOver18 = post.over_18 ? 'nsfw' : 'clean';
            downloadedPosts.subreddit = post.subreddit;
            makeDirectories();

            if (!config.separate_clean_nsfw) {
                downloadDirectory = downloadDirectoryBase + `/${post.subreddit}`;
            } else {
                downloadDirectory =
                    downloadDirectoryBase + `/${isOver18}/${post.subreddit}`;
            }

            if (!fs.existsSync(downloadDirectory)) {
                fs.mkdirSync(downloadDirectory);
            }
            downloadPost(post);
        });
        await sleep();
    }
}

// --- RedGIFs helpers ---
function isRedgifsPost(post) {
    try {
        if (!post) return false;
        const fields = [
            post.domain,
            post.url_overridden_by_dest,
            post.url,
            post.permalink,
            (post.media && post.media.oembed && post.media.oembed.html) || '',
            (post.media && post.media.oembed && post.media.oembed.provider_name) || '',
            (post.preview && post.preview.images && post.preview.images[0] && post.preview.images[0].source && post.preview.images[0].source.url) || '',
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return fields.includes('redgifs.com');
    } catch {
        return false;
    }
}

function extractRedgifsIdFromText(text) {
    if (!text) return null;
    const patterns = [
        /redgifs\.com\/(?:watch|ifr)\/([\w-]+)(?:[\/?#].*)?$/i,
        /redgifs\.com\/([\w-]+)(?:[\/?#].*)?$/i,
        /thumbs\d*\.redgifs\.com\/([\w-]+)-/i,
        /i\.redgifs\.com\/([\w-]+)\.[a-z0-9]+/i,
        /src=["']https?:\/\/(?:www\.)?redgifs\.com\/(?:ifr|watch)\/([\w-]+)["']/i,
    ];

    for (const re of patterns) {
        const m = text.match(re);
        if (m && m[1]) return m[1];
    }
    return null;
}

function getRedgifsIdFromPost(post) {
    const candidates = [
        post.url_overridden_by_dest,
        post.url,
        post.permalink,
        post.domain,
        post.media && post.media.oembed && post.media.oembed.html,
        post.media && post.media.oembed && post.media.oembed.thumbnail_url,
        post.preview && post.preview.images && post.preview.images[0] && post.preview.images[0].source && post.preview.images[0].source.url,
    ].filter(Boolean);

    for (const c of candidates) {
        const id = extractRedgifsIdFromText(String(c));
        if (id) return id;
    }
    return null;
}

async function getRedgifsToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && redgifsToken && now - redgifsTokenFetchedAt < REDGIFS_TOKEN_TTL_MS) {
        return redgifsToken;
    }
    try {
        const res = await axios.get(`${REDGIFS_API_BASE}/auth/temporary`, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'easy-reddit-downloader',
            },
        });
        if (res && res.data && res.data.token) {
            redgifsToken = res.data.token;
            redgifsTokenFetchedAt = Date.now();
            return redgifsToken;
        }
        throw new Error('No token in response');
    } catch (e) {
        throw new Error('Failed to obtain RedGIFs temporary token');
    }
}

async function fetchRedgifsMp4Url(gifId) {
    if (!gifId) throw new Error('Missing RedGIFs ID');
    let token = await getRedgifsToken(false);
    try {
        const res = await axios.get(`${REDGIFS_API_BASE}/gifs/${gifId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'User-Agent': 'easy-reddit-downloader',
            },
        });
        const gif = res && res.data && (res.data.gif || res.data);
        const urls = gif && gif.urls ? gif.urls : null;
        if (urls) {
            return urls.hd || urls.sd || urls.mobile || urls.vmobile || urls.nhd || null;
        }
        if (gif && gif.hdUrl) return gif.hdUrl;
        if (gif && gif.sdUrl) return gif.sdUrl;
        throw new Error('No usable video URL in RedGIFs response');
    } catch (err) {
        if (err.response && err.response.status === 401) {
            token = await getRedgifsToken(true);
            const retry = await axios.get(`${REDGIFS_API_BASE}/gifs/${gifId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    'User-Agent': 'easy-reddit-downloader',
                },
            });
            const gif = retry && retry.data && (retry.data.gif || retry.data);
            const urls = gif && gif.urls ? gif.urls : null;
            if (urls) {
                return urls.hd || urls.sd || urls.mobile || urls.vmobile || urls.nhd || null;
            }
        }
        throw err;
    }
}

// ------------------------------------------
// Post typing

function getPostType(post, postTypeOptions) {
    log(`Analyzing post with title: ${post.title}) and URL: ${post.url}`, true);
    if (post.post_hint === 'self' || post.is_self) {
        postType = 0;
    } else if (
        post.post_hint === 'image' ||
        (post.post_hint === 'rich:video' && !post.domain.includes('youtu')) ||
        post.post_hint === 'hosted:video' ||
        (post.post_hint === 'link' &&
            post.domain.includes('imgur') &&
            !post.url_overridden_by_dest.includes('gallery')) ||
        post.domain.includes('i.redd.it') ||
        post.domain.includes('i.reddituploads.com') ||
        (post.post_hint === 'link' && (post.domain && post.domain.includes('redgifs.com')))
    ) {
        postType = 1; // media
    } else if (post.poll_data != undefined) {
        postType = 3; // poll
    } else if (post.domain.includes('reddit.com') && post.is_gallery) {
        postType = 4; // gallery
    } else {
        postType = 2; // link
    }
    log(
        `Post has type: ${postTypeOptions[postType]} due to their post hint: ${post.post_hint} and domain: ${post.domain}`,
        true,
    );
    return postType;
}

// ------------------------------------------
// Markdown helpers (incl. comments)

function formatUtc(tsSeconds) {
    const d = new Date((tsSeconds || 0) * 1000);
    return isNaN(d.getTime()) ? 'N/A' : d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function baseMetadataLines(post, typeLabel) {
    const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : (post.url || '');
    const lines = [
        `- Author: u/${post.author}`,
        `- Subreddit: r/${post.subreddit}`,
        `- Score: ${post.score}`,
        `- Created: ${formatUtc(post.created_utc || post.created)}`,
        `- Type: ${typeLabel}`,
    ];
    if (permalink) lines.push(`- Permalink: ${permalink}`);
    return lines.join('\n');
}

function renderCommentsRecursive(children, depth, out) {
    if (!Array.isArray(children)) return;
    for (const ch of children) {
        if (!ch || !ch.kind) continue;
        if (ch.kind === 'more') {
            const prefix = '>'.repeat(depth);
            out.push(`${prefix} [more comments]\n`);
            continue;
        }
        if (ch.kind !== 't1' || !ch.data) continue;
        const c = ch.data;
        const prefix = '>'.repeat(depth);
        const author = c.author ? `u/${c.author}` : 'u/[deleted]';
        // Prepare body with quote prefix on each line for nesting
        const body = (c.body || '').split('\n').map(line => `${prefix}${depth ? ' ' : ''}${line}`).join('\n');
        out.push(`${prefix} ${author}:\n${body}\n\n`);
        if (c.replies && c.replies.data && Array.isArray(c.replies.data.children)) {
            renderCommentsRecursive(c.replies.data.children, depth + 1, out);
        }
    }
}

function buildCommentsSection(commentsListing) {
    if (!commentsListing || !commentsListing.data || !Array.isArray(commentsListing.data.children)) {
        return '';
    }
    const out = [];
    out.push(`\n---\n\n## Comments\n\n`);
    renderCommentsRecursive(commentsListing.data.children, 0, out);
    return out.join('');
}

function buildSelfPostMarkdown(post, commentsListing, includeComments) {
    const mdParts = [];
    mdParts.push(`# ${post.title || ''}\n`);
    mdParts.push(baseMetadataLines(post, 'self'));
    mdParts.push(`\n---\n`);
    mdParts.push(`## Post\n\n${post.selftext || ''}\n`);
    if (includeComments) {
        mdParts.push(buildCommentsSection(commentsListing));
    }
    return mdParts.join('');
}

function buildNonSelfMarkdown(kind, post, details = {}, commentsListing, includeComments) {
    const { files = [], sourceUrl = '', linkTarget = '', galleryItems = [], note = '' } = details;
    const md = [];

    md.push(`# ${post.title || ''}\n`);
    md.push(baseMetadataLines(post, kind));
    md.push(`\n---\n`);

    if (kind === 'media') {
        md.push(`## Media\n`);
        if (files.length) {
            md.push(`\nSaved file${files.length > 1 ? 's' : ''}:`);
            files.forEach((f) => md.push(`\n- ${f}`));
            md.push(`\n`);
        }
        if (sourceUrl) md.push(`\nSource URL: ${sourceUrl}\n`);
        if (note) md.push(`\n${note}\n`);
    } else if (kind === 'link') {
        md.push(`## Link\n`);
        md.push(`\nTarget: ${post.url}\n`);
        if (linkTarget) md.push(`\nSaved as: ${linkTarget}\n`);
        if (note) md.push(`\n${note}\n`);
    } else if (kind === 'gallery') {
        md.push(`## Gallery\n`);
        if (galleryItems.length) {
            md.push(`\nItems:`);
            galleryItems.forEach((g) => md.push(`\n- ${g}`));
            md.push(`\n`);
        }
        if (note) md.push(`\n${note}\n`);
    } else if (kind === 'poll') {
        md.push(`## Poll\n`);
        if (post.poll_data && post.poll_data.options) {
            post.poll_data.options.forEach((opt) => {
                const votes = (typeof opt.vote_count === 'number') ? ` (${opt.vote_count} votes)` : '';
                md.push(`\n- ${opt.text}${votes}`);
            });
            md.push(`\n`);
            if (post.poll_data.total_vote_count != null) {
                md.push(`\nTotal votes: ${post.poll_data.total_vote_count}\n`);
            }
        } else {
            md.push(`\nPoll details unavailable.\n`);
        }
        if (note) md.push(`\n${note}\n`);
    } else {
        md.push(`## Content\n`);
        if (note) md.push(`\n${note}\n`);
    }

    if (includeComments) {
        md.push(buildCommentsSection(commentsListing));
    }

    return md.join('');
}

function writeMarkdownSidecar(baseNameWithoutExt, content) {
    try {
        const mdPath = `${downloadDirectory}/${baseNameWithoutExt}.md`;
        if (config.redownload_posts === true || !fs.existsSync(mdPath)) {
            fs.writeFile(mdPath, content, (err) => {
                if (err) log(`Failed to write markdown: ${mdPath} – ${err}`, true);
            });
        }
    } catch (e) {
        log(`Failed to write markdown: ${e}`, true);
    }
}

function permalinkJsonUrl(post) {
    if (post.permalink) {
        return `https://www.reddit.com${post.permalink}.json`;
    }
    // Fallback; might not work for offsite links, but permalink should exist for posts.
    return `${post.url}.json`;
}

async function fetchCommentsListing(post) {
    try {
        const url = permalinkJsonUrl(post);
        const res = await axios.get(url);
        // Reddit returns [postListing, commentsListing]
        return res.data && res.data[1] ? res.data[1] : null;
    } catch (e) {
        log(`Failed to fetch comments for ${post.permalink || post.url}: ${e}`, true);
        return null;
    }
}

// ------------------------------------------

async function downloadMediaFile(downloadURL, filePath, postName) {
    try {
        const response = await axios({
            method: 'GET',
            url: downloadURL,
            responseType: 'stream',
        });

        response.data.pipe(fs.createWriteStream(filePath));

        return new Promise((resolve, reject) => {
            response.data.on('end', () => {
                downloadedPosts.media += 1;
                checkIfDone(postName);
                resolve();
            });

            response.data.on('error', (error) => {
                reject(error);
            });
        });
    } catch (error) {
        downloadedPosts.failed += 1;
        checkIfDone(postName);
        if (error.code === 'ENOTFOUND') {
            log(
                'ERROR: Hostname not found for: ' + downloadURL + '\n... skipping post',
                true,
            );
        } else {
            log('ERROR: ' + error, true);
        }
    }
}

function sleep() {
    return new Promise((resolve) => setTimeout(resolve, postDelayMilliseconds));
}

async function downloadPost(post) {
    let postTypeOptions = ['self', 'media', 'link', 'poll', 'gallery'];
    let postType = -1;

    postType = getPostType(post, postTypeOptions);

    const imageFormats = ['jpeg', 'jpg', 'gif', 'png', 'mp4', 'webm', 'gifv'];

    if (postType == 4) {
        // GALLERY
        const postTitleScrubbed = getFileName(post);

        // Always fetch comments for sidecar
        const commentsListing = await fetchCommentsListing(post);
        const includeComments = true; // include comments for all types

        if (!config.download_gallery_posts) {
            log(`Skipping gallery post with title: ${post.title}`, true);
            downloadedPosts.skipped_due_to_fileType += 1;
            const md = buildNonSelfMarkdown('gallery', post, {
                note: 'Gallery skipped by configuration.'
            }, commentsListing, includeComments);
            writeMarkdownSidecar(postTitleScrubbed, md);
            return checkIfDone(post.name);
        }

        let filesPlanned = [];

        for (const { media_id, id } of post.gallery_data.items) {
            const media = post.media_metadata[media_id];
            const downloadUrl = media['s']['u'].replaceAll('&amp;', '&');
            const shortUrl = downloadUrl.split('?')[0];
            const fileType = shortUrl.split('.').pop();

            const postDirectory = `${downloadDirectory}/${postTitleScrubbed}`;
            if (!fs.existsSync(postDirectory)) {
                fs.mkdirSync(postDirectory);
            }
            const fileRel = `${postTitleScrubbed}/${id}.${fileType}`;
            const fileAbs = `${downloadDirectory}/${fileRel}`;
            filesPlanned.push(fileRel);

            const toDownload = await shouldWeDownload(post.subreddit, fileRel);

            if (toDownload) {
                downloadMediaFile(downloadUrl, fileAbs, post.name);
            }
        }

        const galleryMd = buildNonSelfMarkdown('gallery', post, {
            galleryItems: filesPlanned
        }, commentsListing, includeComments);
        writeMarkdownSidecar(postTitleScrubbed, galleryMd);

    } else if (postType != 3 && post.url !== undefined) {
        let downloadURL = post.url;
        let fileType = downloadURL.split('.').pop();
        let postTitleScrubbed = getFileName(post);

        if (postType === 0) {
            // SELF → Markdown + all comments
            const commentsListing = await fetchCommentsListing(post);
            const includeComments = true;

            let toDownload = await shouldWeDownload(post.subreddit, `${postTitleScrubbed}.md`);
            if (!toDownload) {
                downloadedPosts.skipped_due_to_duplicate += 1;
                return checkIfDone(post.name);
            } else {
                if (!config.download_self_posts) {
                    log(`Skipping self post with title: ${post.title}`, true);
                    downloadedPosts.skipped_due_to_fileType += 1;
                    return checkIfDone(post.name);
                } else {
                    // Use post.selftext already present; comments fetched above
                    const markdown = buildSelfPostMarkdown(
                        post,
                        commentsListing,
                        includeComments,
                    );

                    fs.writeFile(
                        `${downloadDirectory}/${postTitleScrubbed}.md`,
                        markdown,
                        function (err) {
                            if (err) {
                                log(err, true);
                            }
                            downloadedPosts.self += 1;
                            if (checkIfDone(post.name)) {
                                return;
                            }
                        },
                    );
                }
            }
        } else if (postType === 1) {
            // MEDIA (image/video)

            // Resolve RedGIFs if needed
            if (config.download_redgifs_videos && isRedgifsPost(post)) {
                try {
                    const gifId = getRedgifsIdFromPost(post);
                    if (gifId) {
                        const redgifsUrl = await fetchRedgifsMp4Url(gifId);
                        if (redgifsUrl) {
                            downloadURL = redgifsUrl;
                            fileType = 'mp4';
                            log(`Resolved RedGIFs ${gifId} -> ${redgifsUrl}`, true);
                        }
                    }
                } catch (e) {
                    log(`RedGIFs resolution failed (${post.url}). Falling back to previews.`, true);
                }
            }

            if (post.preview != undefined && (!config.download_redgifs_videos || !isRedgifsPost(post) || (isRedgifsPost(post) && !downloadURL.includes('redgifs') && !downloadURL.endsWith('.mp4')))) {
                if (post.preview.reddit_video_preview != undefined) {
                    log(
                        "Using fallback URL for Reddit's GIF preview." +
                        post.preview.reddit_video_preview,
                        true,
                    );
                    downloadURL = post.preview.reddit_video_preview.fallback_url;
                    fileType = 'mp4';
                } else if (post.url_overridden_by_dest && post.url_overridden_by_dest.includes('.gifv')) {
                    log('Replacing gifv with mp4', true);
                    downloadURL = post.url_overridden_by_dest.replace('.gifv', '.mp4');
                    fileType = 'mp4';
                } else if (post.preview && post.preview.images && post.preview.images[0] && post.preview.images[0].source) {
                    let sourceURL = post.preview.images[0].source.url;
                    for (let i = 0; i < imageFormats.length; i++) {
                        if (sourceURL.toLowerCase().includes(imageFormats[i].toLowerCase())) {
                            fileType = imageFormats[i];
                            break;
                        }
                    }
                    downloadURL = sourceURL.replaceAll('&amp;', '&');
                }
            }

            if (post.media != undefined && post.post_hint == 'hosted:video') {
                downloadURL = post.media.reddit_video.fallback_url;
                fileType = 'mp4';
            } else if (
                post.media != undefined &&
                post.post_hint == 'rich:video' &&
                post.media.oembed && post.media.oembed.thumbnail_url != undefined
            ) {
                if (!(config.download_redgifs_videos && isRedgifsPost(post))) {
                    downloadURL = post.media.oembed.thumbnail_url;
                    fileType = 'gif';
                }
            }

            // Fetch comments for sidecar
            const commentsListing = await fetchCommentsListing(post);
            const includeComments = true;

            if (!config.download_media_posts) {
                log(`Skipping media post with title: ${post.title}`, true);
                downloadedPosts.skipped_due_to_fileType += 1;

                const md = buildNonSelfMarkdown('media', post, {
                    files: [`${postTitleScrubbed}.${fileType}`],
                    sourceUrl: downloadURL,
                    note: 'Media skipped by configuration.'
                }, commentsListing, includeComments);
                writeMarkdownSidecar(postTitleScrubbed, md);

                return checkIfDone(post.name);
            } else {
                // Write sidecar first
                const sidecar = buildNonSelfMarkdown('media', post, {
                    files: [`${postTitleScrubbed}.${fileType}`],
                    sourceUrl: downloadURL
                }, commentsListing, includeComments);
                writeMarkdownSidecar(postTitleScrubbed, sidecar);

                let toDownload = await shouldWeDownload(
                    post.subreddit,
                    `${postTitleScrubbed}.${fileType}`,
                );
                if (!toDownload) {
                    downloadedPosts.skipped_due_to_duplicate += 1;
                    if (checkIfDone(post.name)) {
                        return;
                    }
                } else {
                    downloadMediaFile(
                        downloadURL,
                        `${downloadDirectory}/${postTitleScrubbed}.${fileType}`,
                        post.name,
                    );
                }
            }
        } else if (postType === 2) {
            // LINK POSTS

            const includeComments = true;
            const commentsListing = await fetchCommentsListing(post);

            // RedGIFs link treated as media when enabled
            if (config.download_redgifs_videos && isRedgifsPost(post)) {
                try {
                    const gifId = getRedgifsIdFromPost(post);
                    if (gifId) {
                        const redgifsUrl = await fetchRedgifsMp4Url(gifId);
                        if (redgifsUrl) {
                            const postTitleScrubbed2 = postTitleScrubbed;
                            const sidecar = buildNonSelfMarkdown('media', post, {
                                files: [`${postTitleScrubbed2}.mp4`],
                                sourceUrl: redgifsUrl,
                                note: 'Original post was a link; video downloaded from RedGIFs.'
                            }, commentsListing, includeComments);
                            writeMarkdownSidecar(postTitleScrubbed2, sidecar);

                            let toDownload = await shouldWeDownload(
                                post.subreddit,
                                `${postTitleScrubbed2}.mp4`,
                            );
                            if (!toDownload) {
                                downloadedPosts.skipped_due_to_duplicate += 1;
                                if (checkIfDone(post.name)) {
                                    return;
                                }
                            } else {
                                await downloadMediaFile(
                                    redgifsUrl,
                                    `${downloadDirectory}/${postTitleScrubbed2}.mp4`,
                                    post.name,
                                );
                                return;
                            }
                        }
                    }
                } catch (e) {
                    log(`RedGIFs link resolution failed (${post.url}). Saving redirect HTML instead.`, true);
                }
            }

            if (!config.download_link_posts) {
                log(`Skipping link post with title: ${post.title}`, true);
                downloadedPosts.skipped_due_to_fileType += 1;

                const md = buildNonSelfMarkdown('link', post, {
                    linkTarget: '(not saved due to configuration)'
                }, commentsListing, includeComments);
                writeMarkdownSidecar(postTitleScrubbed, md);

                return checkIfDone(post.name);
            } else {
                if (
                    post.domain.includes('youtu') &&
                    config.download_youtube_videos_experimental
                ) {
                    log(
                        `Downloading ${postTitleScrubbed} from YouTube... This may take a while...`,
                        false,
                    );
                    let url = post.url;
                    try {
                        if (!ytdl.validateURL(url)) {
                            throw new Error('Invalid YouTube URL');
                        }

                        const info = await ytdl.getInfo(url);
                        log(info, true);

                        const format = ytdl.chooseFormat(info.formats, {
                            quality: 'highest',
                        });

                        const fileName = `${postTitleScrubbed}.mp4`;

                        const audio = ytdl(url, { filter: 'audioonly' });
                        const audioPath = `${downloadDirectory}/${fileName}.mp3`;
                        audio.pipe(fs.createWriteStream(audioPath));

                        const video = ytdl(url, { format });
                        const videoPath = `${downloadDirectory}/${fileName}.mp4`;
                        video.pipe(fs.createWriteStream(videoPath));

                        // Sidecar for YouTube-download case (with comments)
                        const md = buildNonSelfMarkdown('link', post, {
                            linkTarget: fileName,
                            note: 'Video fetched via YouTube; file will appear after merge completes.'
                        }, commentsListing, includeComments);
                        writeMarkdownSidecar(postTitleScrubbed, md);

                        await Promise.all([
                            new Promise((resolve) => audio.on('end', resolve)),
                            new Promise((resolve) => video.on('end', resolve)),
                        ]);

                        ffmpeg()
                            .input(videoPath)
                            .input(audioPath)
                            .output(`${downloadDirectory}/${fileName}`)
                            .on('end', () => {
                                console.log('Download complete');
                                fs.unlinkSync(audioPath);
                                fs.unlinkSync(videoPath);
                                downloadedPosts.link += 1;
                                if (checkIfDone(post.name)) {
                                    return;
                                }
                            })
                            .run();
                    } catch (error) {
                        log(
                            `Failed to download ${postTitleScrubbed} from YouTube. Do you have FFMPEG installed? https://ffmpeg.org/ `,
                            false,
                        );
                        let htmlFile = `<html><body><script type='text/javascript'>window.location.href = "${post.url}";</script></body></html>`;

                        fs.writeFile(
                            `${downloadDirectory}/${postTitleScrubbed}.html`,
                            htmlFile,
                            function (err) {
                                if (err) throw err;
                                downloadedPosts.link += 1;

                                const md = buildNonSelfMarkdown('link', post, {
                                    linkTarget: `${postTitleScrubbed}.html`,
                                    note: 'Saved as HTML redirect (YouTube fallback).'
                                }, commentsListing, includeComments);
                                writeMarkdownSidecar(postTitleScrubbed, md);

                                if (checkIfDone(post.name)) {
                                    return;
                                }
                            },
                        );
                    }
                } else {
                    let htmlFile = `<html><body><script type='text/javascript'>window.location.href = "${post.url}";</script></body></html>`;

                    fs.writeFile(
                        `${downloadDirectory}/${postTitleScrubbed}.html`,
                        htmlFile,
                        function (err) {
                            if (err) throw err;
                            downloadedPosts.link += 1;

                            const md = buildNonSelfMarkdown('link', post, {
                                linkTarget: `${postTitleScrubbed}.html`
                            }, commentsListing, includeComments);
                            writeMarkdownSidecar(postTitleScrubbed, md);

                            if (checkIfDone(post.name)) {
                                return;
                            }
                        },
                    );
                }
            }
        } else {
            log('Failed to download: ' + post.title + 'with URL: ' + post.url, true);
            downloadedPosts.failed += 1;
            if (checkIfDone(post.name)) {
                return;
            }
        }
    } else if (postType === 3) {
        // POLL → create .md summary with all comments
        const postTitleScrubbed = getFileName(post);
        const commentsListing = await fetchCommentsListing(post);
        const includeComments = true;
        const md = buildNonSelfMarkdown('poll', post, {}, commentsListing, includeComments);
        writeMarkdownSidecar(postTitleScrubbed, md);
        // Count as "self" for stats (text-like)
        downloadedPosts.self += 1;
        if (checkIfDone(post.name)) return;
    } else {
        log('Failed to download: ' + post.title + 'with URL: ' + post.url, true);
        downloadedPosts.failed += 1;
        if (checkIfDone(post.name)) {
            return;
        }
    }
}

function downloadNextSubreddit() {
    if (currentSubredditIndex > subredditList.length) {
        checkIfDone('', true);
    } else {
        currentSubredditIndex += 1;
        downloadSubredditPosts(subredditList[currentSubredditIndex]);
    }
}

function shouldWeDownload(subreddit, postTitleWithPrefixAndExtension) {
    if (
        config.redownload_posts === true ||
        config.redownload_posts === undefined
    ) {
        if (config.redownload_posts === undefined) {
            log(
                chalk.red(
                    "ALERT: Please note that the 'redownload_posts' option is now available in user_config. See the default JSON for example usage.",
                ),
                true,
            );
        }
        return true;
    } else {
        let postExists = fs.existsSync(
            `${downloadDirectory}/${postTitleWithPrefixAndExtension}`,
        );
        return !postExists;
    }
}

function onErr(err) {
    log(err, true);
    return 1;
}

function checkIfDone(lastPostId, override) {
    if (config.download_post_list_options.enabled) {
        if (numberOfPostsRemaining()[0] > 0) {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/all)`,
                false,
            );
        } else {
            log(`Finished downloading posts from download_post_list.txt`, false);
            downloadedPosts = {
                subreddit: '',
                self: 0,
                media: 0,
                link: 0,
                failed: 0,
                skipped_due_to_duplicate: 0,
                skipped_due_to_fileType: 0,
            };
            if (config.download_post_list_options.repeatForever) {
                log(
                    `⏲️ Waiting ${
                        config.download_post_list_options.timeBetweenRuns / 1000
                    } seconds before rerunning...`,
                    false,
                );
                setTimeout(function () {
                    startTime = new Date();
                    downloadFromPostListFile();
                }, timeBetweenRuns);
            }
        }
    } else if (
        (lastAPICallForSubreddit &&
            lastPostId ===
            currentAPICall.data.children[responseSize - 1].data.name) ||
        numberOfPostsRemaining()[0] === 0 ||
        override ||
        (numberOfPostsRemaining()[1] === responseSize && responseSize < 100)
    ) {
        let endTime = new Date();
        let timeDiff = endTime - startTime;
        timeDiff /= 1000;
        let msPerPost = (timeDiff / numberOfPostsRemaining()[1])
            .toString()
            .substring(0, 5);
        if (numberOfPosts >= 99999999999999999999) {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/all)`,
                false,
            );
        } else {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/${numberOfPosts})`,
                false,
            );
        }
        if (numberOfPostsRemaining()[0] === 0) {
            log('Validating that all posts were downloaded...', false);
            setTimeout(() => {
                log(
                    '🎉 All done downloading posts from ' +
                    subredditList[currentSubredditIndex] +
                    '!',
                    false,
                );

                log(JSON.stringify(downloadedPosts), true);
                if (currentSubredditIndex === subredditList.length - 1) {
                    log(
                        `\n📈 Downloading took ${timeDiff} seconds, at about ${msPerPost} seconds/post`,
                        false,
                    );
                }

                downloadedPosts = {
                    subreddit: '',
                    self: 0,
                    media: 0,
                    link: 0,
                    failed: 0,
                    skipped_due_to_duplicate: 0,
                    skipped_due_to_fileType: 0,
                };

                if (currentSubredditIndex < subredditList.length - 1) {
                    downloadNextSubreddit();
                } else if (repeatForever) {
                    currentSubredditIndex = 0;
                    log(
                        `⏲️ Waiting ${timeBetweenRuns / 1000} seconds before rerunning...`,
                        false,
                    );
                    setTimeout(function () {
                        downloadSubredditPosts(subredditList[0], '');
                        startTime = new Date();
                    }, timeBetweenRuns);
                } else {
                    startPrompt();
                }
                return true;
            }, 1000);
        }
    } else {
        if (numberOfPosts >= 99999999999999999999) {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/all)`,
                false,
            );
        } else {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/${numberOfPosts})`,
                false,
            );
        }

        for (let i = 0; i < Object.keys(downloadedPosts).length; i++) {
            log(
                `\t- ${Object.keys(downloadedPosts)[i]}: ${
                    Object.values(downloadedPosts)[i]
                }`,
                true,
            );
        }
        log('\n', true);

        if (numberOfPostsRemaining()[1] % 100 == 0) {
            return downloadSubredditPosts(
                subredditList[currentSubredditIndex],
                lastPostId,
            );
        }
        return false;
    }
}

function getFileName(post) {
    let fileName = '';
    if (
        config.file_naming_scheme.showDate ||
        config.file_naming_scheme.showDate === undefined
    ) {
        let timestamp = post.created;
        var date = new Date(timestamp * 1000);
        var year = date.getFullYear();
        var month = (date.getMonth() + 1).toString().padStart(2, '0');
        var day = date.getDate().toString().padStart(2, '0');
        fileName += `${year}-${month}-${day}`;
    }
    if (
        config.file_naming_scheme.showScore ||
        config.file_naming_scheme.showScore === undefined
    ) {
        fileName += `_score=${post.score}`;
    }
    if (
        config.file_naming_scheme.showSubreddit ||
        config.file_naming_scheme.showSubreddit === undefined
    ) {
        fileName += `_${post.subreddit}`;
    }
    if (
        config.file_naming_scheme.showAuthor ||
        config.file_naming_scheme.showAuthor === undefined
    ) {
        fileName += `_${post.author}`;
    }
    if (
        config.file_naming_scheme.showTitle ||
        config.file_naming_scheme.showTitle === undefined
    ) {
        let title = sanitizeFileName(post.title);
        fileName += `_${title}`;
    }

    fileName = fileName.replace(/(?:\r\n|\r|\n|\t)/g, '');

    if (fileName.search(/\ufe0e/g) >= -1) {
        fileName = fileName.replace(/\ufe0e/g, '');
    }

    if (fileName.search(/\ufe0f/g) >= -1) {
        fileName = fileName.replace(/\ufe0f/g, '');
    }

    if (fileName.length > 240) {
        fileName = fileName.substring(0, 240);
    }

    return fileName;
}

function numberOfPostsRemaining() {
    let total =
        downloadedPosts.self +
        downloadedPosts.media +
        downloadedPosts.link +
        downloadedPosts.failed +
        downloadedPosts.skipped_due_to_duplicate +
        downloadedPosts.skipped_due_to_fileType;
    return [numberOfPosts - total, total];
}

function log(message, detailed) {
    userLogs += message + '\r\n';
    let visibleToUser = true;
    if (detailed) {
        visibleToUser = config.detailed_logs;
    }

    if (visibleToUser) {
        console.log(message);
    }
    if (config.local_logs && subredditList.length > 0) {
        if (!fs.existsSync('./logs')) {
            fs.mkdirSync('./logs');
        }

        let logFileName = '';
        if (config.local_logs_naming_scheme.showDateAndTime) {
            logFileName += `${date_string} - `;
        }
        if (config.local_logs_naming_scheme.showSubreddits) {
            let subredditListString = JSON.stringify(subredditList).replace(
                /[^a-zA-Z0-9,]/g,
                '',
            );
            logFileName += `${subredditListString} - `;
        }
        if (config.local_logs_naming_scheme.showNumberOfPosts) {
            if (numberOfPosts < 999999999999999999) {
                logFileName += `ALL - `;
            } else {
                logFileName += `${numberOfPosts} - `;
            }
        }

        if (logFileName.endsWith(' - ')) {
            logFileName = logFileName.substring(0, logFileName.length - 3);
        }

        fs.writeFile(
            `./logs/${logFileName}.${logFormat}`,
            userLogs,
            function (err) {
                if (err) throw err;
            },
        );
    }
}

function sanitizeFileName(fileName) {
    return fileName
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/([^/])\/([^/])/g, '$1_$2');
}
