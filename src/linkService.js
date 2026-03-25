const { supabase } = require('./database');
const { fetchAndNormalize } = require('./crawler');
const { sha256, generateShortCode, now, validateAndNormalizeUrl, hashPreview } = require('./utils');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Create a new short link with content integrity snapshot.
 */
async function createShortLink(rawUrl) {
  const url = validateAndNormalizeUrl(rawUrl);

  const { data: existing } = await supabase
    .from('links')
    .select('*')
    .eq('originalUrl', url)
    .single();

  if (existing) {
    return formatLinkResponse(existing, true);
  }

  const content = await fetchAndNormalize(url);
  const baselineHash = sha256(content.text);

  let shortCode;
  let attempts = 0;
  let isUnique = false;
  do {
    shortCode = generateShortCode();
    attempts++;
    if (attempts > 10) throw new Error('Could not generate unique short code');
    
    // Check uniqueness
    const { data } = await supabase.from('links').select('shortCode').eq('shortCode', shortCode).single();
    if (!data) {
      isUnique = true;
    }
  } while (!isUnique);

  const createdAt = now();

  const { data: record, error } = await supabase
    .from('links')
    .insert([{
      shortCode,
      originalUrl: url,
      title: content.title,
      baselineHash,
      contentLength: content.contentLength,
      createdAt,
      lastCheckedAt: createdAt
    }])
    .select()
    .single();

  if (error) throw error;

  return formatLinkResponse(record, false);
}

/**
 * Check integrity of a link and return full integrity report.
 */
async function checkIntegrity(shortCode) {
  const { data: record } = await supabase.from('links').select('*').eq('shortCode', shortCode).single();
  if (!record) return null;

  const checkedAt = now();
  let integrityStatus = 'UNKNOWN';
  let freshHash = null;
  let freshTitle = record.title;
  let errorMessage = null;

  let newModificationCount = record.modificationCount;
  let newLastModifiedAt = record.lastModifiedAt;
  let newBaselineHash = record.baselineHash;

  try {
    const content = await fetchAndNormalize(record.originalUrl);
    freshHash = sha256(content.text);
    freshTitle = content.title;

    if (freshHash === record.baselineHash) {
      integrityStatus = 'UNCHANGED';
    } else {
      integrityStatus = 'MODIFIED';

      await supabase.from('modifications').insert([{
        shortCode,
        detectedAt: checkedAt,
        previousHash: record.baselineHash,
        newHash: freshHash
      }]);

      newModificationCount = record.modificationCount + 1;
      newLastModifiedAt = checkedAt;
      newBaselineHash = freshHash;
    }
  } catch (err) {
    integrityStatus = 'CHECK_FAILED';
    errorMessage = err.message;
  }

  // Update link record stats
  await supabase.from('links').update({
    modificationCount: newModificationCount,
    lastModifiedAt: newLastModifiedAt,
    baselineHash: newBaselineHash,
    clickCount: record.clickCount + 1,
    lastCheckedAt: checkedAt
  }).eq('shortCode', shortCode);

  // Log this click
  await supabase.from('clicks').insert([{
    shortCode,
    clickedAt: checkedAt,
    integrityStatus
  }]);

  const { data: updated } = await supabase.from('links').select('*').eq('shortCode', shortCode).single();

  return {
    shortCode,
    originalUrl: record.originalUrl,
    title: freshTitle || record.title,
    shortUrl: `${BASE_URL}/s/${shortCode}`,
    integrityStatus,
    hashMatch: freshHash ? (freshHash === record.baselineHash) : null,
    baselineHash: record.baselineHash,
    currentHash: freshHash || null,
    baselineHashPreview: hashPreview(record.baselineHash),
    currentHashPreview: freshHash ? hashPreview(freshHash) : null,
    createdAt: record.createdAt,
    checkedAt,
    clickCount: updated.clickCount,
    modificationCount: updated.modificationCount,
    lastModifiedAt: updated.lastModifiedAt,
    errorMessage
  };
}

/**
 * Get full statistics for a link, including modification history.
 */
async function getLinkStats(shortCode) {
  const { data: record } = await supabase.from('links').select('*').eq('shortCode', shortCode).single();
  if (!record) return null;

  const { data: modifications } = await supabase.from('modifications').select('*').eq('shortCode', shortCode).order('detectedAt', { ascending: false });
  const { data: recentClicks } = await supabase.from('clicks').select('*').eq('shortCode', shortCode).order('clickedAt', { ascending: false }).limit(20);

  return {
    ...formatLinkResponse(record, false),
    modifications: (modifications || []).map(m => ({
      detectedAt: m.detectedAt,
      previousHashPreview: hashPreview(m.previousHash),
      newHashPreview: hashPreview(m.newHash)
    })),
    recentClicks: recentClicks || [],
    modificationRate: record.clickCount > 0
      ? ((record.modificationCount / record.clickCount) * 100).toFixed(1)
      : 0
  };
}

/**
 * Get all links for dashboard view.
 */
async function getAllLinks() {
  const { data: links } = await supabase.from('links').select('*').order('createdAt', { ascending: false }).limit(100);
  return (links || []).map(l => formatLinkResponse(l, false));
}

/**
 * Get global statistics for the dashboard header.
 */
async function getGlobalStats() {
  const { count: totalLinks } = await supabase.from('links').select('*', { count: 'exact', head: true });
  
  const { data: links } = await supabase.from('links').select('clickCount, modificationCount');
  
  let totalClicks = 0;
  let modifiedLinks = 0;
  let totalModifications = 0;

  if (links) {
     for (const l of links) {
       totalClicks += (Number(l.clickCount) || 0);
       if ((Number(l.modificationCount) || 0) > 0) modifiedLinks++;
       totalModifications += (Number(l.modificationCount) || 0);
     }
  }

  return { 
    totalLinks: totalLinks || 0, 
    totalClicks, 
    modifiedLinks, 
    totalModifications 
  };
}

/**
 * Delete a link and all associated records.
 */
async function deleteLink(shortCode) {
  // We rely on Supabase cascading deletes (ON DELETE CASCADE) to clean up clicks and modifications
  await supabase.from('links').delete().eq('shortCode', shortCode);
  return true;
}

// ── Internal helpers ──

function formatLinkResponse(record, isExisting) {
  return {
    shortCode: record.shortCode,
    shortUrl: `${BASE_URL}/s/${record.shortCode}`,
    originalUrl: record.originalUrl,
    title: record.title,
    baselineHashPreview: hashPreview(record.baselineHash),
    baselineHash: record.baselineHash,
    createdAt: record.createdAt,
    clickCount: record.clickCount,
    modificationCount: record.modificationCount,
    lastModifiedAt: record.lastModifiedAt,
    lastCheckedAt: record.lastCheckedAt,
    contentLength: record.contentLength,
    isExisting: isExisting || false,
    integrityStatus: record.modificationCount > 0 ? 'MODIFIED' : 'UNCHANGED'
  };
}

module.exports = {
  createShortLink,
  checkIntegrity,
  getLinkStats,
  getAllLinks,
  getGlobalStats,
  deleteLink
};
