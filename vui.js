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
            tokenDisplayName: 'The Golden Floppy Disk',
            description: 'Exclusive Gold Asset for Teraflops members'
        },
        '1293319793981526077': { 
            name: 'Gigaflops', 
            amount: '1', 
            token: 'Silver',
            tokenDisplayName: 'The Silver Floppy Disk',
            description: 'Silver Asset for Gigaflops members'
        },
        '1293319628566560849': { 
            name: 'Megaflops', 
            amount: '1', 
            token: 'Bronze',
            tokenDisplayName: 'The Bronze Floppy Disk',
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
            
            if (backendResponse.ok) {
                const backendData = await backendResponse.json();
                
                if (backendData.success && backendData.profile && backendData.profile.id) {
                    console.log('✅ Found profile via backend:', backendData.profile);
                    userState.bazarProfile = backendData.profile;
                    showBazarProfileInfo(backendData.profile);
                    showStatus('✅ Wallet connected and Bazar profile found!', 'success');
                    nextStep();
                    return;
                } else if (backendData.requiresProfile) {
                    // Backend specifically says profile is required
                    console.log('📝 Backend says profile is required');
                    showStatus('No Bazar profile found. You must create one to receive rewards.', 'error');
                    showBazarProfileHelp();
                    return;
                }
            }
            
            // If we get here, something went wrong
            throw new Error('Profile lookup service unavailable. Please ensure you have a Bazar profile.');
            
        } catch (profileError) {
            console.error('❌ Bazar profile lookup error:', profileError);
            
            // No manual entry - just fail and show help
            showStatus('❌ No Bazar profile found for this wallet address. You must create a Bazar profile to receive rewards.', 'error');
            showBazarProfileHelp();
            
            // Do not proceed - user must create profile and restart
            userState.bazarProfile = null;
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
        console.log('📋 Reward details received:', result.rewardDetails);

        if (result.success) {
            showStatus('🎉 Verification successful! Asset transfer completed!', 'success');
            showRewardSuccess(result.reward);
            completeStep();
        } else {
            // Handle specific error types with better messaging
            if (result.alreadyClaimed || result.errorType === 'ALREADY_CLAIMED') {
                const claimDate = result.claimDate ? new Date(result.claimDate).toLocaleDateString() : 'previously';
                const roleName = result.rewardDetails?.roleName || 'your role';
                const tokenDisplayName = result.rewardDetails?.tokenDisplayName || result.rewardDetails?.token || 'reward';
                const txId = result.transactionId;
                
                let message = `🎯 You've already claimed your ${roleName} role reward (${tokenDisplayName})!`;
                if (claimDate !== 'previously') {
                    message += `\n\nClaimed on: ${claimDate}`;
                }
                if (txId) {
                    message += `\nTransaction: ${txId.substring(0, 12)}...`;
                }
                message += '\n\nEach role reward can only be claimed once.';
                
                showStatus(message, 'error');
                showAlreadyClaimedInfo(result);
                
            } else if (result.errorType === 'DUPLICATE_CLAIM') {
                const roleName = result.rewardDetails?.roleName || 'your role';
                const tokenDisplayName = result.rewardDetails?.tokenDisplayName || result.rewardDetails?.token || 'reward';
                showStatus(`⚠️ You've already claimed your ${roleName} reward (${tokenDisplayName})! Each role reward can only be claimed once.`, 'error');
                
            } else if (result.errorType === 'DATABASE_ERROR') {
                showStatus('❌ Database error occurred. Please try again later or contact support.', 'error');
                
            } else if (result.message && result.message.includes('Bazar profile')) {
                showStatus(`❌ ${result.message}`, 'error');
                showBazarProfileHelp();
                
            } else {
                // Generic error
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

function showAlreadyClaimedInfo(result) {
    if (!result.rewardDetails) return;
    
    const tokenDisplayName = result.rewardDetails.tokenDisplayName || result.rewardDetails.token || 'Unknown Reward';
    const roleName = result.rewardDetails.roleName || 'Unknown Role';
    const amount = result.rewardDetails.amount || '1';
    
    const claimedInfoHtml = `
        <div style="margin-top: 1rem; padding: 1.5rem; background: linear-gradient(135deg, #2a1a1a, #1a1a2a); border-radius: 8px; border: 1px solid #ff6b35;">
            <h4 style="color: #ff6b35; margin-bottom: 1rem; text-align: center;">🎯 Reward Already Claimed</h4>
            <div style="text-align: left; color: #ccc;">
                <p><strong>Role:</strong> ${roleName}</p>
                <p><strong>Reward:</strong> ${amount} ${tokenDisplayName}</p>
                ${result.claimDate ? `<p><strong>Claimed:</strong> ${new Date(result.claimDate).toLocaleDateString()}</p>` : ''}
                ${result.transactionId ? `<p><strong>Transaction:</strong> <a href="https://www.ao.link/#/message/${result.transactionId}" target="_blank" style="color: #5865f2;">${result.transactionId.substring(0, 12)}...${result.transactionId.substring(result.transactionId.length - 8)}</a></p>` : ''}
                <p><strong>Status:</strong> ${result.rewardDetails.status || 'Confirmed'}</p>
            </div>
            <div style="text-align: center; margin-top: 1rem; padding: 1rem; background: rgba(255, 107, 53, 0.1); border-radius: 6px;">
                <p style="font-size: 0.9rem; color: #ff6b35; margin: 0;">
                    💡 <strong>Each eligible role reward can only be claimed once.</strong>
                </p>
            </div>
        </div>
    `;
    
    statusDiv.innerHTML += claimedInfoHtml;
}

function showBazarProfileHelp() {
    const helpHtml = `
        <div style="margin-top: 1rem; padding: 1rem; background: #2a2a2a; border-radius: 8px; text-align: left;">
            <h4 style="color: #ff6b35; margin-bottom: 0.5rem;">🏪 Bazar Profile Required</h4>
            <p style="font-size: 0.9rem; margin-bottom: 0.5rem;">
                To receive AO assets, you need a Bazar profile linked to your wallet address.
            </p>
            
            <div style="margin: 1rem 0; padding: 1rem; background: #1a1a1a; border-radius: 6px;">
                <strong style="color: #10b981;">How to create a Bazar profile:</strong>
                <ol style="font-size: 0.9rem; margin: 0.5rem 0 0 1rem;">
                    <li>Visit <a href="https://bazar.arweave.dev" target="_blank" style="color: #5865f2;">bazar.arweave.dev</a></li>
                    <li>Connect the same wallet you used here</li>
                    <li>Create your profile with username and details</li>
                    <li><strong>Refresh this page and try connecting your wallet again</strong></li>
                </ol>
            </div>
            
            <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(255, 107, 53, 0.1); border-radius: 6px; border-left: 4px solid #ff6b35;">
                <p style="font-size: 0.9rem; color: #ff6b35; margin: 0;">
                    <strong>⚠️ Important:</strong> Your Bazar profile must be created with the same wallet address you're using here. Once created, it should be automatically detected.
                </p>
            </div>
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