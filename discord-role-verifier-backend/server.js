// server.js - Improved version with profile lookup endpoint
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const Arweave = require('arweave');
const { connect, createDataItemSigner, message, result } = require('@permaweb/aoconnect');
require('dotenv').config();

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Environment variables
const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_BOT_TOKEN,
    AO_SERVER_ID,
    WALLET_PATH,
    GOLD_ASSET_ID,
    SILVER_ASSET_ID,
    BRONZE_ASSET_ID,
    DATABASE_PATH = './rewards.db'
} = process.env;

// Verify environment variables
if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_BOT_TOKEN) {
    console.error('❌ Missing Discord configuration!');
    process.exit(1);
}

// Initialize Arweave and AO
const arweave = Arweave.init({});
const ao = connect();

// Load wallet for signing transactions
let wallet;
let signer;
let permaweb; // Store Permaweb instance

// Replace the initializeWallet function with this version that tries multiple import approaches

async function initializeWallet() {
    try {
        wallet = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
        signer = createDataItemSigner(wallet);
        console.log('✅ Wallet loaded successfully');
        
        // Try to initialize Permaweb with multiple approaches
        try {
            console.log('🔄 Initializing Permaweb libs...');
            
            // First, let's see what the package actually exports
            const permawebPackage = require('@permaweb/libs');
            console.log('📦 Permaweb package type:', typeof permawebPackage);
            console.log('📦 Permaweb package keys:', Object.keys(permawebPackage));
            console.log('📦 Has default:', 'default' in permawebPackage);
            console.log('📦 Has init:', 'init' in permawebPackage);
            console.log('📦 Default type:', typeof permawebPackage.default);
            
            let Permaweb;
            
            // Approach 1: Try default export (ES6 style)
            if (permawebPackage.default && typeof permawebPackage.default.init === 'function') {
                console.log('✅ Using default export');
                Permaweb = permawebPackage.default;
            }
            // Approach 2: Try direct export
            else if (typeof permawebPackage.init === 'function') {
                console.log('✅ Using direct export');
                Permaweb = permawebPackage;
            }
            // Approach 3: Check if it's a named export
            else if (permawebPackage.Permaweb && typeof permawebPackage.Permaweb.init === 'function') {
                console.log('✅ Using named export');
                Permaweb = permawebPackage.Permaweb;
            }
            // Approach 4: Maybe it's just the init function directly
            else if (typeof permawebPackage === 'function') {
                console.log('✅ Package is the init function itself');
                permaweb = permawebPackage({
                    ao: ao,
                    arweave: arweave,
                    signer: signer
                });
            }
            else {
                throw new Error('Cannot find init method in package. Available: ' + Object.keys(permawebPackage).join(', '));
            }
            
            // If we found a Permaweb object with init method, use it
            if (Permaweb && typeof Permaweb.init === 'function') {
                console.log('🚀 Calling Permaweb.init...');
                permaweb = Permaweb.init({
                    ao: ao,
                    arweave: arweave,
                    signer: signer
                });
                console.log('✅ Permaweb initialized successfully');
            }
            
            // Verify the result
            if (permaweb) {
                console.log('📋 Permaweb instance type:', typeof permaweb);
                console.log('📋 Available methods:', Object.getOwnPropertyNames(permaweb).filter(name => typeof permaweb[name] === 'function'));
                console.log('📋 Has getProfileByWalletAddress:', typeof permaweb.getProfileByWalletAddress === 'function');
            } else {
                throw new Error('Permaweb initialization returned null/undefined');
            }
            
        } catch (permawebError) {
            console.error('❌ Permaweb libs initialization failed:', permawebError);
            console.error('❌ Full error details:', permawebError.stack);
            console.log('   Package might not be compatible with CommonJS require()');
            permaweb = null;
        }
        
        return true;
    } catch (error) {
        console.error('❌ Failed to load wallet:', error.message);
        console.log('Please ensure wallet.json exists and is properly formatted');
        return false;
    }
}

// Asset configuration
const ASSET_CONFIG = {
    '1372348346512965674': { // Teraflops
        name: 'Teraflops',
        amount: '1',
        token: 'Gold',
        tokenDisplayName: 'The Golden Floppy Disk',
        assetId: GOLD_ASSET_ID
    },
    '1293319793981526077': { // Gigaflops
        name: 'Gigaflops',
        amount: '1',
        token: 'Silver',
        tokenDisplayName: 'The Silver Floppy Disk',
        assetId: SILVER_ASSET_ID
    },
    '1293319628566560849': { // Megaflops
        name: 'Megaflops',
        amount: '1',
        token: 'Bronze',
        tokenDisplayName: 'The Bronze Floppy Disk',
        assetId: BRONZE_ASSET_ID
    }
};

// Initialize SQLite database
const db = new sqlite3.Database(DATABASE_PATH);

// Fixed database creation section
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_user_id TEXT NOT NULL,
            wallet_address TEXT NOT NULL,
            bazar_profile_id TEXT,
            role_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            tx_id TEXT NOT NULL,
            amount TEXT NOT NULL,
            token TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            confirmed_at DATETIME,
            UNIQUE(discord_user_id, role_id)
        )
    `);
});

function checkExistingReward(discordUserId, roleId) {
    return new Promise((resolve, reject) => {
        // Check multiple scenarios for existing rewards
        const queries = [
            // Check by discord user + role
            'SELECT * FROM rewards WHERE discord_user_id = ? AND role_id = ?'
        ];
        
        console.log(`🔍 Checking for existing reward: User ${discordUserId}, Role ${roleId}`);
        
        // Use the more general check (user + role) to prevent any duplicates
        db.get(queries[0], [discordUserId, roleId], (err, row) => {
            if (err) {
                console.error('❌ Database error checking existing rewards:', err);
                reject(err);
            } else {
                if (row) {
                    console.log('⚠️  Found existing reward:', row);
                } else {
                    console.log('✅ No existing reward found, user can claim');
                }
                resolve(row);
            }
        });
    });
}

function saveRewardRecord(data) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO rewards (discord_user_id, wallet_address, bazar_profile_id, role_id, asset_id, tx_id, amount, token) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.discordUserId, data.walletAddress, data.bazarProfileId || 'DIRECT_TO_WALLET', data.roleId, data.assetId, data.txId, data.amount, data.token],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// Enhanced profile lookup endpoint with proper error handling
app.get('/api/lookup-profile/:address', async (req, res) => {
    const { address } = req.params;
    
    if (!address) {
        return res.status(400).json({
            success: false,
            message: 'Wallet address required'
        });
    }
    
    // Validate address format (Arweave addresses are 43 characters)
    if (address.length !== 43) {
        return res.status(400).json({
            success: false,
            message: 'Invalid wallet address format'
        });
    }
    
    try {
        console.log(`🔍 Looking up Bazar profile for address: ${address}`);
        
        if (!permaweb) {
            console.log('❌ Permaweb not initialized, profile lookup unavailable');
            return res.json({
                success: false,
                message: 'Profile lookup service unavailable. Please ensure you have a Bazar profile.',
                requiresProfile: true, // Changed from requiresManualEntry
                debug: 'permaweb_not_initialized'
            });
        }
        
        // Check if getProfileByWalletAddress method exists
        if (typeof permaweb.getProfileByWalletAddress !== 'function') {
            console.log('❌ getProfileByWalletAddress method not available');
            console.log('📋 Available methods:', Object.getOwnPropertyNames(permaweb).filter(name => typeof permaweb[name] === 'function'));
            return res.json({
                success: false,
                message: 'Profile lookup method not available. Please ensure you have a Bazar profile.',
                requiresProfile: true, // Changed from requiresManualEntry
                debug: 'method_not_available'
            });
        }
        
        console.log('🚀 Calling permaweb.getProfileByWalletAddress...');
        
        // Call the profile lookup method as per docs
        const profile = await permaweb.getProfileByWalletAddress(address);
        
        console.log(`👤 Raw profile lookup result:`, profile);
        console.log(`📋 Profile type:`, typeof profile);
        console.log(`📋 Profile keys:`, profile ? Object.keys(profile) : 'null');
        
        // Check if we got a valid profile according to docs format
        if (profile && profile.id) {
            console.log(`✅ Found valid profile with ID: ${profile.id}`);
            
            res.json({
                success: true,
                profile: {
                    id: profile.id,
                    walletAddress: profile.walletAddress || address,
                    username: profile.username || 'Unknown',
                    displayName: profile.displayName || 'Unknown',
                    description: profile.description || '',
                    thumbnail: profile.thumbnail || null,
                    banner: profile.banner || null,
                    assets: profile.assets || []
                }
            });
        } else {
            console.log(`❌ No valid profile found - profile:`, profile);
            res.json({
                success: false,
                message: 'No Bazar profile found for this wallet address. Please create one at bazar.arweave.dev',
                requiresProfile: true, // Changed from requiresManualEntry
                debug: {
                    profileExists: !!profile,
                    hasId: !!(profile && profile.id),
                    profileData: profile
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Profile lookup error details:');
        console.error('   Error message:', error.message);
        console.error('   Error stack:', error.stack);
        console.error('   Error type:', error.constructor.name);
        
        res.status(500).json({
            success: false,
            message: 'Profile lookup failed: ' + error.message + '. Please ensure you have a Bazar profile.',
            requiresProfile: true, // Changed from requiresManualEntry
            debug: {
                errorType: error.constructor.name,
                errorMessage: error.message
            }
        });
    }
});

// Debug endpoint to test permaweb initialization
app.get('/api/debug/permaweb', (req, res) => {
    try {
        const debugInfo = {
            permawebInitialized: !!permaweb,
            walletLoaded: !!wallet,
            signerAvailable: !!signer,
            aoConnected: !!ao,
            arweaveInitialized: !!arweave,
            timestamp: new Date().toISOString()
        };
        
        if (permaweb) {
            debugInfo.permawebMethods = Object.getOwnPropertyNames(permaweb)
                .filter(name => typeof permaweb[name] === 'function');
            debugInfo.hasProfileMethod = typeof permaweb.getProfileByWalletAddress === 'function';
        }
        
        res.json(debugInfo);
    } catch (error) {
        res.status(500).json({
            error: error.message,
            debug: 'permaweb_debug_failed'
        });
    }
});

// Discord OAuth2 endpoint (same as before)
app.post('/api/auth/discord', async (req, res) => {
    const { code, eligibleRoles } = req.body;
    
    if (!code) {
        return res.status(400).json({ success: false, message: 'No authorization code provided' });
    }

    const ROLE_REWARDS = eligibleRoles || ASSET_CONFIG;

    try {
        console.log('🔄 Exchanging Discord code for token...');
        
        const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', 
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: 'http://localhost:8080',
                scope: 'identify guilds.members.read'
            }), 
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const { access_token, token_type } = tokenResponse.data;
        console.log('✅ Got access token');

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { 'Authorization': `${token_type} ${access_token}` }
        });

        const user = userResponse.data;
        console.log(`👤 User: ${user.username}#${user.discriminator} (${user.id})`);

        const memberResponse = await axios.get(
            `https://discord.com/api/v10/guilds/${AO_SERVER_ID}/members/${user.id}`,
            {
                headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` }
            }
        );

        const member = memberResponse.data;
        const validRoleIds = Object.keys(ROLE_REWARDS);
        const userValidRoles = member.roles.filter(roleId => validRoleIds.includes(roleId));
        const hasValidRole = userValidRoles.length > 0;
        
        let eligibleRole = null;
        if (hasValidRole) {
            eligibleRole = validRoleIds.find(roleId => userValidRoles.includes(roleId));
        }
        
        console.log(`🎯 Eligible role: ${eligibleRole ? ROLE_REWARDS[eligibleRole].name : 'None'}`);

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                discriminator: user.discriminator,
                avatar: user.avatar,
                accessToken: access_token
            },
            hasRequiredRole: hasValidRole,
            eligibleRole: eligibleRole,
            rewardTier: eligibleRole ? ROLE_REWARDS[eligibleRole] : null,
            serverMember: true
        });

    } catch (error) {
        console.error('❌ Discord auth error:', error.response?.data || error.message);
        
        if (error.response?.status === 404) {
            return res.json({
                success: false,
                message: 'User is not a member of the AO server',
                serverMember: false
            });
        }

        res.status(500).json({
            success: false,
            message: 'Discord authentication failed',
            error: error.response?.data?.error_description || error.message
        });
    }
});

// Enhanced verify endpoint with better debugging
app.post('/api/verify-and-reward', async (req, res) => {
    const { discordUserId, walletAddress, bazarProfileId, accessToken, roleId, eligibleRoles } = req.body;

    console.log('🔍 Verification request received:');
    console.log('  Discord User ID:', discordUserId);
    console.log('  Wallet Address:', walletAddress);
    console.log('  Bazar Profile ID:', bazarProfileId);
    console.log('  Role ID:', roleId);

    if (!discordUserId || !walletAddress) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required fields: discordUserId and walletAddress' 
        });
    }

    if (!bazarProfileId) {
        console.log('❌ Missing bazarProfileId in request');
        return res.status(400).json({
            success: false,
            message: 'Bazar profile ID required to receive rewards. Please create a Bazar profile first.'
        });
    }

    if (!signer) {
        return res.status(500).json({
            success: false,
            message: 'Wallet not initialized properly'
        });
    }

    const ROLE_REWARDS = eligibleRoles || ASSET_CONFIG;

    try {
        console.log('🔄 Final verification for user:', discordUserId);
        console.log('💰 Wallet address:', walletAddress);
        console.log('🏪 Bazar profile:', bazarProfileId);

        // Double-check user still has valid roles
        const memberResponse = await axios.get(
            `https://discord.com/api/v10/guilds/${AO_SERVER_ID}/members/${discordUserId}`,
            {
                headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` }
            }
        );

        const member = memberResponse.data;
        const validRoleIds = Object.keys(ROLE_REWARDS);
        const userValidRoles = member.roles.filter(roleId => validRoleIds.includes(roleId));
        
        if (userValidRoles.length === 0) {
            return res.json({
                success: false,
                message: 'User does not have any eligible roles'
            });
        }

        const eligibleRoleId = roleId && userValidRoles.includes(roleId) 
            ? roleId 
            : userValidRoles[0];
            
        const rewardConfig = ASSET_CONFIG[eligibleRoleId];

        // Debug: Log the asset configuration
        console.log('🔍 Debug - Reward config for role:', eligibleRoleId);
        console.log('🔍 Debug - Asset ID:', rewardConfig.assetId);
        console.log('🔍 Debug - Environment variables:');
        console.log('   GOLD_ASSET_ID:', GOLD_ASSET_ID);
        console.log('   SILVER_ASSET_ID:', SILVER_ASSET_ID);  
        console.log('   BRONZE_ASSET_ID:', BRONZE_ASSET_ID);

        // Check if reward already claimed (now includes Bazar profile)
        const existingReward = await checkExistingReward(discordUserId, eligibleRoleId, bazarProfileId);
        if (existingReward) {
            console.log('⚠️  User already claimed this reward:', existingReward);
            return res.json({
                success: false,
                message: `You have already claimed your ${rewardConfig.name} role reward! Each role reward can only be claimed once.`,
                alreadyClaimed: true,
                errorType: 'ALREADY_CLAIMED',
                claimDate: existingReward.created_at,
                transactionId: existingReward.tx_id,
                rewardDetails: {
                    roleName: rewardConfig.name,           
                    token: rewardConfig.token,              
                    tokenDisplayName: rewardConfig.tokenDisplayName, 
                    amount: rewardConfig.amount
                }
            });
        }
        
        console.log('🔍 DETAILED DEBUG:');
        console.log('   Eligible Role ID:', eligibleRoleId);
        console.log('   Eligible Role ID Type:', typeof eligibleRoleId);
        console.log('   ASSET_CONFIG keys:', Object.keys(ROLE_REWARDS));
        console.log('   ASSET_CONFIG key types:', Object.keys(ROLE_REWARDS).map(key => typeof key));
        console.log('   Direct lookup result:', ROLE_REWARDS[eligibleRoleId]);
        console.log('   String lookup result:', ROLE_REWARDS[String(eligibleRoleId)]);
        console.log('   Full ROLE_REWARDS:', JSON.stringify(ROLE_REWARDS, null, 2));
        // AO asset transfer
        console.log('🚀 Sending AO asset transfer...');
        const assetId = rewardConfig.assetId;
        
        const transferResult = await permaweb.sendMessage({
            processId: "a2U7UBrMaI0uVzhhbOfUzuyuyIVTcsRVmI_B26nRwrw",
            action: "Run-Action",
            tags: [
              { name: "Action", value: "Run-Action" },
              { name: "ForwardAction", value: "Transfer" },
              { name: "ForwardTo", value: assetId },
              { name: "Target", value: assetId },
              { name: "Recipient", value: bazarProfileId },
              { name: "Quantity", value: "1" },
            ],
            data: {
              Target: assetId,
              Action: "Transfer"
            }
        });

        const txId = transferResult;
        console.log(`✅ Transfer message sent: ${txId}`);

        // Save reward record
        await saveRewardRecord({
            discordUserId,
            walletAddress,
            bazarProfileId: bazarProfileId,
            roleId: eligibleRoleId,
            assetId: assetId,
            txId: txId,
            amount: rewardConfig.amount,
            token: rewardConfig.token
        });

        const reward = {
            txId: txId,
            amount: rewardConfig.amount,
            token: rewardConfig.token,
            roleName: rewardConfig.name,
            roleId: eligibleRoleId,
            recipient: bazarProfileId,
            walletAddress: walletAddress,
            assetId: assetId,
            timestamp: new Date().toISOString(),
            confirmed: false
        };

        console.log('🎉 Reward processed and saved:', reward);

        res.json({
            success: true,
            message: `Verification successful! ${rewardConfig.amount} ${rewardConfig.token} sent for ${rewardConfig.name} role.`,
            reward: reward
        });

    } catch (saveError) {
        console.error('❌ Error saving reward record:', saveError);
        
        // Check if it's a UNIQUE constraint error (already claimed)
        if (saveError.message && saveError.message.includes('UNIQUE constraint failed')) {
            console.log('🔄 User attempted to claim reward they already have');
            
            return res.json({
                success: false,
                message: `You have already claimed your ${rewardConfig.name} role reward! Each role reward can only be claimed once.`,
                alreadyClaimed: true,
                errorType: 'DUPLICATE_CLAIM',
                rewardDetails: {
                    roleName: rewardConfig.name,
                    token: rewardConfig.token,
                    tokenDisplayName: rewardConfig.tokenDisplayName,
                    amount: rewardConfig.amount
                }
            });
        } else {
            // Some other database error
            return res.status(500).json({
                success: false,
                message: 'Failed to save reward record: ' + saveError.message,
                errorType: 'DATABASE_ERROR'
            });
        }
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        config: {
            hasClientId: !!DISCORD_CLIENT_ID,
            hasClientSecret: !!DISCORD_CLIENT_SECRET,
            hasBotToken: !!DISCORD_BOT_TOKEN,
            hasServerId: !!AO_SERVER_ID,
            hasWallet: !!wallet,
            hasPermaweb: !!permaweb,
            hasAssetIds: !!(GOLD_ASSET_ID && SILVER_ASSET_ID && BRONZE_ASSET_ID),
            databaseConnected: true
        }
    });
});

// Get reward history
app.get('/api/rewards/:discordUserId?', (req, res) => {
    const { discordUserId } = req.params;
    
    let query = 'SELECT * FROM rewards ORDER BY created_at DESC';
    let params = [];
    
    if (discordUserId) {
        query = 'SELECT * FROM rewards WHERE discord_user_id = ? ORDER BY created_at DESC';
        params = [discordUserId];
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else {
            res.json({ success: true, rewards: rows });
        }
    });
});

// Debug endpoint to check profile lookup
app.get('/api/debug/profile/:address', async (req, res) => {
    const { address } = req.params;
    
    try {
        console.log('🔍 Debug profile lookup for:', address);
        
        const debugInfo = {
            address: address,
            permawebAvailable: !!permaweb,
            timestamp: new Date().toISOString()
        };
        
        if (permaweb) {
            try {
                const profile = await permaweb.getProfileByWalletAddress(address);
                debugInfo.profile = profile;
                debugInfo.hasProfile = !!(profile && profile.id);
            } catch (error) {
                debugInfo.error = error.message;
                debugInfo.hasProfile = false;
            }
        }
        
        res.json(debugInfo);
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            address: address
        });
    }
});

// Start server
async function startServer() {
    const walletInitialized = await initializeWallet();
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
        console.log('');
        console.log('Environment check:');
        console.log(`✅ Discord Client ID: ${DISCORD_CLIENT_ID ? 'Set' : '❌ Missing'}`);
        console.log(`✅ Discord Client Secret: ${DISCORD_CLIENT_SECRET ? 'Set' : '❌ Missing'}`);
        console.log(`✅ Discord Bot Token: ${DISCORD_BOT_TOKEN ? 'Set' : '❌ Missing'}`);
        console.log(`✅ AO Server ID: ${AO_SERVER_ID ? 'Set' : '❌ Missing'}`);
        console.log(`✅ Wallet: ${walletInitialized ? 'Loaded' : '❌ Failed'}`);
        console.log(`✅ Permaweb: ${permaweb ? 'Initialized' : '❌ Failed'}`);
        console.log(`✅ Asset IDs: ${(GOLD_ASSET_ID && SILVER_ASSET_ID && BRONZE_ASSET_ID) ? 'Set' : '❌ Missing (will simulate)'}`);
        console.log('');
        console.log('🗃️ Database initialized');
        console.log('');
        console.log('Available endpoints:');
        console.log('  POST /api/auth/discord - Discord OAuth');
        console.log('  GET  /api/lookup-profile/:address - Profile lookup');
        console.log('  POST /api/verify-and-reward - Verify and reward');
        console.log('  GET  /api/debug/profile/:address - Debug profile lookup');
        
        if (!walletInitialized) {
            console.log('⚠️  Wallet initialization failed - rewards will be simulated');
        }
        
        if (!(GOLD_ASSET_ID && SILVER_ASSET_ID && BRONZE_ASSET_ID)) {
            console.log('⚠️  Asset IDs not configured - rewards will be simulated');
        }
    });
}

startServer();