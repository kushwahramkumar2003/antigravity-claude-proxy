/**
 * User Onboarding
 *
 * Handles provisioning of managed projects for accounts that don't have one.
 */

import {
    ONBOARD_USER_ENDPOINTS,
    ANTIGRAVITY_HEADERS
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/helpers.js';

/**
 * Get the default tier ID from allowed tiers list
 *
 * @param {Array} allowedTiers - List of allowed tiers from loadCodeAssist
 * @returns {string|undefined} Default tier ID
 */
export function getDefaultTierId(allowedTiers) {
    if (!allowedTiers || allowedTiers.length === 0) {
        return undefined;
    }

    // Find the tier marked as default
    for (const tier of allowedTiers) {
        if (tier?.isDefault) {
            return tier.id;
        }
    }

    // Fall back to first tier
    return allowedTiers[0]?.id;
}

/**
 * Onboard a user to get a managed project
 *
 * @param {string} token - OAuth access token
 * @param {string} tierId - Tier ID (e.g., 'FREE', 'PRO', 'ULTRA')
 * @param {string} [projectId] - Optional GCP project ID (required for non-FREE tiers)
 * @param {number} [maxAttempts=10] - Maximum polling attempts
 * @param {number} [delayMs=5000] - Delay between polling attempts
 * @returns {Promise<string|null>} Managed project ID or null if failed
 */
export async function onboardUser(token, tierId, projectId = null, maxAttempts = 10, delayMs = 5000) {
    const metadata = {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
    };

    if (projectId) {
        metadata.duetProject = projectId;
    }

    const requestBody = {
        tierId,
        metadata
    };

    // Non-FREE tiers require a cloudaicompanionProject
    if (tierId !== 'FREE' && projectId) {
        requestBody.cloudaicompanionProject = projectId;
    }

    for (const endpoint of ONBOARD_USER_ENDPOINTS) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await fetch(`${endpoint}/v1internal:onboardUser`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        ...ANTIGRAVITY_HEADERS
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.debug(`[Onboarding] onboardUser failed at ${endpoint}: ${response.status} - ${errorText}`);
                    break; // Try next endpoint
                }

                const data = await response.json();
                logger.debug(`[Onboarding] onboardUser response (attempt ${attempt + 1}):`, JSON.stringify(data));

                // Check if onboarding is complete
                const managedProjectId = data.response?.cloudaicompanionProject?.id;
                if (data.done && managedProjectId) {
                    return managedProjectId;
                }
                if (data.done && projectId) {
                    return projectId;
                }

                // Not done yet, wait and retry
                if (attempt < maxAttempts - 1) {
                    logger.debug(`[Onboarding] onboardUser not complete, waiting ${delayMs}ms...`);
                    await sleep(delayMs);
                }
            } catch (error) {
                logger.debug(`[Onboarding] onboardUser error at ${endpoint}:`, error.message);
                break; // Try next endpoint
            }
        }
    }

    return null;
}
