import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: NextRequest) {
  let videoPath = '';

  try {
    const { url } = await request.json();

    if (!url || !url.includes('youtube.com') && !url.includes('youtu.be')) {
      return NextResponse.json(
        { success: false, error: 'URL YouTube invalide' },
        { status: 400 }
      );
    }

           // ==================== STRATÉGIES DE TÉLÉCHARGEMENT YT-DLP ====================
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesPath);

    const rawStrategies = [
      hasCookies
        ? `yt-dlp --cookies "${cookiesPath}" --no-warnings --no-playlist --max-filesize 200M -f "best[height<=720]/best" -o "${videoPath}" "${url}"`
        : null,

      `yt-dlp --cookies-from-browser chrome --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --extractor-args "youtube:player_client=android,web" --no-warnings --no-playlist --max-filesize 200M -f "best[height<=720]/best" -o "${videoPath}" "${url}"`,

      `yt-dlp --no-warnings --no-playlist --max-filesize 250M --extractor-args "youtube:player_client=android,web" -o "${videoPath}" "${url}"`,

      `yt-dlp --no-warnings --no-playlist --max-filesize 300M -o "${videoPath}" "${url}"`,
    ];

    const strategies = rawStrategies.filter((s): s is string => s !== null);

    let success = false;
    let lastError = '';

    for (let i = 0; i < strategies.length; i++) {
      try {
        console.log(`Tentative de téléchargement ${i + 1}/${strategies.length}...`);
        
        execSync(strategies[i], { stdio: 'inherit', timeout: 90000 });

        if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 100000) {
          success = true;
          console.log("✅ Téléchargement réussi !");
          break;
        }
      } catch (err: any) {
        lastError = err.message || err.toString();
        console.log(`Tentative ${i + 1} échouée.`);

        if (fs.existsSync(videoPath)) {
          try { fs.unlinkSync(videoPath); } catch (e) {}
        }
      }
    }

    return NextResponse.json({
      success: true,
      analysis,
    });

  } catch (error: any) {
    console.error("Erreur globale :", error.message);

    // Nettoyage en cas d’erreur
    if (videoPath && fs.existsSync(videoPath)) {
      try { fs.unlinkSync(videoPath); } catch (e) {}
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}