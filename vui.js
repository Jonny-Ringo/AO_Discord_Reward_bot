// vui.js - Updated frontend with Bazar profile support
// Configuration - WITH YOUR ACTUAL VALUES
const CONFIG = {
    discordClientId: '1376684488339357837', // Your Discord app client ID
    discordRedirectUri: 'http://localhost:8080', // Local testing on port 8080
    serverId: '1210396395643863101', // Your AO server ID
    apiBaseUrl: 'http://localhost:3001/api', // backend
    
    // Multiple roles with different reward tiers
    eligibleRoles: {
        '1372348346512965674': { 
            name: 'Teraflops', 
            amount: '1', 
            token: 'Gold',
            description: 'Exclusive Gold Asset for Teraflops members'
        },
        '1293319793981526077': { 
            name: 'Gigaflops', 
            amount: '1', 
            token: 'Silver',
            description: 'Silver Asset for Gigaflops members'
        },
        '1293319628566560849': { 
            name: 'Megaflops', 
            amount: '1', 
            token: 'Bronze',
            description: 'Bronze Asset for Megaflops members'
        }
    }
};

// State management
let currentStep = 1;
let userState = {
    discord: null,
    wallet: null,
    bazarProfile: null,
    verified: false
};

// DOM elements
const discordLoginBtn = document.getElementById('discordLoginBtn');
const walletConnectBtn = document.getElementById('walletConnectBtn');
const verifyRolesBtn = document.getElementById('verifyRolesBtn');
const statusDiv = document.getElementById('status');
const rewardSection = document.getElementById('rewardSection');

// Event listeners
discordLoginBtn.addEventListener('click', initiateDiscordLogin);
walletConnectBtn.addEventListener('click', connectWallet);
verifyRolesBtn.addEventListener('click', verifyRolesAndClaim);

// Discord OAuth2 login
function initiateDiscordLogin() {
    const scope = 'identify guilds.members.read';
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.discordClientId}&redirect_uri=${encodeURIComponent(CONFIG.discordRedirectUri)}&response_type=code&scope=${scope}`;
    
    // Open Discord auth in popup or redirect
    window.location.href = discordAuthUrl;
}

// Handle Discord OAuth callback
async function handleDiscordCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
        showStatus('Connecting to Discord...', 'loading');
        
        try {
            // Exchange code for access token via backend
            const response = await fetch(`${CONFIG.apiBaseUrl}/auth/discord`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    code,
                    eligibleRoles: CONFIG.eligibleRoles // Send role config to backend
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                userState.discord = data.user;
                userState.discord.eligibleRole = data.eligibleRole;
                userState.discord.rewardTier = data.rewardTier;
                showDiscordUser(data.user);
                
                if (data.hasRequiredRole) {
                    const tierInfo = data.rewardTier ? ` (${data.rewardTier.name} - ${data.rewardTier.amount} ${data.rewardTier.token})` : '';
                    showStatus(`Discord connected! You have an eligible role ✅${tierInfo}`, 'success');
                } else {
                    showStatus('Discord connected, but you don\'t have any eligible roles ❌', 'error');
                    return; // Don't proceed to next step
                }
                
                // Clean up URL by removing the code parameter
                const cleanUrl = window.location.origin + window.location.pathname;
                window.history.replaceState({}, document.title, cleanUrl);
                
                nextStep();
            } else {
                showStatus(data.message || 'Discord authentication failed', 'error');
            }
        } catch (error) {
            showStatus('Discord connection error - is your backend running?', 'error');
            console.error('Discord auth error:', error);
        }
    }
}

// Connect Wander wallet
async function connectWallet() {
    showStatus('Connecting to Wander wallet...', 'loading');
    
    try {
        // Check if Wander wallet is available
        if (typeof window.arweaveWallet === 'undefined') {
            showStatus('Wander wallet not found. Please install the Wander extension.', 'error');
            return;
        }

        // Request wallet connection
        await window.arweaveWallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION']);
        
        // Get wallet address
        const address = await window.arweaveWallet.getActiveAddress();
        
        userState.wallet = { address };
        showWalletInfo(address);
        
        // Now lookup Bazar profile
        showStatus('Looking up your Bazar profile...', 'loading');
        
        try {
            console.log('📡 Looking up Bazar profile via backend...');
            
            const backendResponse = await fetch(`${CONFIG.apiBaseUrl}/lookup-profile/${address}`);
            const backendData = await backendResponse.json();
            
            if (backendData.success && backendData.profile && backendData.profile.id) {
                console.log('✅ Found profile via backend:', backendData.profile);
                userState.bazarProfile = backendData.profile;
                showBazarProfileInfo(backendData.profile);
                showStatus('✅ Wallet connected and Bazar profile found!', 'success');
                nextStep();
            } else {
                throw new Error(backendData.message || 'No Bazar profile found for this wallet address');
            }
            
        } catch (profileError) {
            console.error('❌ Bazar profile lookup error:', profileError);
            
            // Show detailed error and manual override option
            showStatus('❌ No Bazar profile found for this wallet address.', 'error');
            showBazarProfileHelp();
            
            // Allow manual profile ID entry as fallback
            setTimeout(() => {
                showManualProfileInput();
            }, 2000);
        }
        
    } catch (error) {
        if (error.message.includes('User rejected')) {
            showStatus('Wallet connection cancelled', 'error');
        } else {
            showStatus('Failed to connect wallet', 'error');
        }
        console.error('Wallet connection error:', error);
    }
}

// Show manual profile input option
function showManualProfileInput() {
    const manualInputHtml = `
        <div id="manualProfileInput" style="margin-top: 1rem; padding: 1rem; background: #2a2a2a; border-radius: 8px;">
            <h4 style="color: #5865f2; margin-bottom: 0.5rem;">Manual Profile Entry</h4>
            <p style="font-size: 0.9rem; margin-bottom: 1rem;">
                If you have a Bazar profile but it wasn't found automatically, you can enter your profile ID manually:
            </p>
            <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                <input 
                    type="text" 
                    id="manualProfileId" 
                    placeholder="Enter your Bazar profile ID (43 characters)" 
                    style="flex: 1; padding: 0.5rem; border-radius: 4px; border: 1px solid #555; background: #1a1a1a; color: white;"
                />
                <button 
                    id="submitManualProfile" 
                    style="padding: 0.5rem 1rem; border-radius: 4px; border: none; background: #5865f2; color: white; cursor: pointer;"
                >
                    Use This ID
                </button>
            </div>
            <p style="font-size: 0.8rem; color: #888;">
                Your profile ID should be 43 characters long and start with letters/numbers.
            </p>
        </div>
    `;
    
    statusDiv.innerHTML += manualInputHtml;
    
    // Add event listener for manual submission
    document.getElementById('submitManualProfile').addEventListener('click', () => {
        const profileId = document.getElementById('manualProfileId').value.trim();
        
        if (profileId.length === 43) {
            userState.bazarProfile = { 
                id: profileId, 
                username: 'Manual Entry',
                displayName: 'Manual Entry',
                walletAddress: userState.wallet.address
            };
            
            showBazarProfileInfo(userState.bazarProfile);
            showStatus('✅ Manual profile ID accepted! Proceeding...', 'success');
            
            // Remove manual input section
            document.getElementById('manualProfileInput').remove();
            
            nextStep();
        } else {
            showStatus('❌ Invalid profile ID. Should be 43 characters long.', 'error');
        }
    });
}

// Verify roles and claim reward
async function verifyRolesAndClaim() {
    if (!userState.discord || !userState.wallet) {
        showStatus('Please complete all authentication steps first', 'error');
        return;
    }

    if (!userState.bazarProfile || !userState.bazarProfile.id) {
        showStatus('❌ Bazar profile required to receive rewards. Please create one first.', 'error');
        showBazarProfileHelp();
        return;
    }

    showStatus('Verifying roles and processing AO asset transfer...', 'loading');
    verifyRolesBtn.disabled = true;

    try {
        console.log('🚀 Submitting verification with data:', {
            discordUserId: userState.discord.id,
            walletAddress: userState.wallet.address,
            bazarProfileId: userState.bazarProfile.id,
            roleId: userState.discord.eligibleRole
        });

        const response = await fetch(`${CONFIG.apiBaseUrl}/verify-and-reward`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                discordUserId: userState.discord.id,
                walletAddress: userState.wallet.address,
                bazarProfileId: userState.bazarProfile.id, // This should now be properly set
                accessToken: userState.discord.accessToken,
                roleId: userState.discord.eligibleRole,
                eligibleRoles: CONFIG.eligibleRoles
            })
        });

        const result = await response.json();
        console.log('📋 Verification result:', result);

        if (result.success) {
            showStatus('🎉 Verification successful! Asset transfer completed!', 'success');
            showRewardSuccess(result.reward);
            completeStep();
        } else {
            if (result.alreadyClaimed) {
                showStatus('⚠️ ' + result.message, 'error');
            } else if (result.message.includes('Bazar profile')) {
                showStatus(`❌ ${result.message}`, 'error');
                showBazarProfileHelp();
            } else {
                showStatus(result.message || 'Verification failed', 'error');
            }
        }
    } catch (error) {
        showStatus('Verification error - is your backend running?', 'error');
        console.error('Verification error:', error);
    } finally {
        verifyRolesBtn.disabled = false;
    }
}

// UI helper functions
function showDiscordUser(user) {
    document.getElementById('discordUserInfo').style.display = 'block';
    document.getElementById('discordUsername').textContent = `@${user.username}#${user.discriminator}`;
    document.getElementById('discordId').textContent = `ID: ${user.id}`;
    discordLoginBtn.textContent = '✓ Connected to Discord';
    discordLoginBtn.disabled = true;
}

function showBazarProfileInfo(profile) {
    // Add Bazar profile info section to the wallet step
    const walletStep = document.getElementById('walletStep');
    
    // Remove any existing Bazar info
    const existingBazarInfo = document.getElementById('bazarProfileInfo');
    if (existingBazarInfo) {
        existingBazarInfo.remove();
    }
    
    // Create Bazar profile info section
    const bazarInfoHtml = `
        <div id="bazarProfileInfo" class="user-info" style="margin-top: 1rem;">
            <h4>
                <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                Bazar Profile Connected
            </h4>
            <p><strong>Profile ID:</strong> ${profile.id.substring(0, 12)}...${profile.id.substring(profile.id.length - 8)}</p>
            <p><strong>Username:</strong> ${profile.username || 'Not set'}</p>
            <p><strong>Display Name:</strong> ${profile.displayName || 'Not set'}</p>
        </div>
    `;
    
    walletStep.insertAdjacentHTML('beforeend', bazarInfoHtml);
}

function showWalletInfo(address) {
    document.getElementById('walletInfo').style.display = 'block';
    document.getElementById('walletAddress').textContent = `Address: ${address.substring(0, 12)}...${address.substring(address.length - 8)}`;
    walletConnectBtn.textContent = '✓ Wallet Connected';
    walletConnectBtn.disabled = true;
}

function showRewardSuccess(reward) {
    rewardSection.style.display = 'block';
    
    const confirmationStatus = reward.confirmed 
        ? '✅ Confirmed on AO Network' 
        : '⏳ Transfer sent, awaiting confirmation';
    
    document.getElementById('rewardInfo').innerHTML = `
        <strong>Role:</strong> ${reward.roleName || 'N/A'}<br>
        <strong>Asset:</strong> ${reward.amount} ${reward.token}<br>
        <strong>Transaction ID:</strong> <a href="https://www.ao.link/#/message/${reward.txId}" target="_blank">${reward.txId.substring(0, 12)}...</a><br>
        <strong>Recipient:</strong> ${reward.recipient}<br>
        <strong>Status:</strong> ${confirmationStatus}<br>
        <strong>Asset Process:</strong> <a href="https://www.ao.link/#/token/${reward.assetId}" target="_blank">${reward.assetId.substring(0, 12)}...</a>
    `;
}

function showBazarProfileHelp() {
    const helpHtml = `
        <div style="margin-top: 1rem; padding: 1rem; background: #2a2a2a; border-radius: 8px; text-align: left;">
            <h4 style="color: #ff6b35; margin-bottom: 0.5rem;">🏪 Bazar Profile Required</h4>
            <p style="font-size: 0.9rem; margin-bottom: 0.5rem;">
                To receive AO assets, you need a Bazar profile linked to your wallet address.
            </p>
            <p style="font-size: 0.9rem; margin-bottom: 0.5rem;">
                <strong>How to create one:</strong>
            </p>
            <ol style="font-size: 0.9rem; margin-left: 1rem;">
                <li>Visit <a href="https://bazar.arweave.dev" target="_blank" style="color: #5865f2;">bazar.arweave.dev</a></li>
                <li>Connect the same wallet you used here</li>
                <li>Create your profile</li>
                <li>Return here and try claiming again</li>
            </ol>
        </div>
    `;
    
    statusDiv.innerHTML += helpHtml;
}

function nextStep() {
    if (currentStep < 3) {
        document.getElementById(`step${currentStep}`).classList.remove('active');
        document.getElementById(`step${currentStep}`).classList.add('completed');
        
        currentStep++;
        
        document.querySelector('.step.active').classList.remove('active');
        document.getElementById(`${getStepName(currentStep)}Step`).classList.add('active');
        document.getElementById(`step${currentStep}`).classList.add('active');
    }
}

function completeStep() {
    document.getElementById(`step${currentStep}`).classList.remove('active');
    document.getElementById(`step${currentStep}`).classList.add('completed');
}

function getStepName(step) {
    const steps = ['', 'discord', 'wallet', 'verification'];
    return steps[step];
}

function showStatus(message, type) {
    statusDiv.className = `status ${type}`;
    
    if (type === 'loading') {
        statusDiv.innerHTML = `<span class="loading-spinner"></span>${message}`;
    } else {
        statusDiv.innerHTML = message;
    }
    
    statusDiv.style.display = 'block';
}

// Initialize app
window.addEventListener('load', () => {
    // Check if this is a Discord OAuth callback
    if (window.location.search.includes('code=')) {
        handleDiscordCallback();
    }
});