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

    // ==================== DOSSIER TEMPORAIRE (compatible Vercel + Local) ====================
    const tempDir = os.tmpdir();
    videoPath = path.join(tempDir, `video_${Date.now()}.mp4`);

    // ==================== STRATÉGIES DE TÉLÉCHARGEMENT YT-DLP ====================
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesPath);

    const strategies = [
      // 1. Meilleure option : cookies.txt (recommandé sur Vercel)
      hasCookies
        ? `yt-dlp --cookies "${cookiesPath}" --no-warnings --no-playlist --max-filesize 200M -f "best[height<=720]/best" -o "${videoPath}" "${url}"`
        : null,

      // 2. Cookies navigateur Chrome (fonctionne très bien en local)
      `yt-dlp --cookies-from-browser chrome --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --extractor-args "youtube:player_client=android,web" --no-warnings --no-playlist --max-filesize 200M -f "best[height<=720]/best" -o "${videoPath}" "${url}"`,

      // 3. Fallback sans cookies (extractor renforcé)
      `yt-dlp --no-warnings --no-playlist --max-filesize 250M --extractor-args "youtube:player_client=android,web" -o "${videoPath}" "${url}"`,

      // 4. Dernier recours ultra permissif
      `yt-dlp --no-warnings --no-playlist --max-filesize 300M -o "${videoPath}" "${url}"`,
    ].filter(Boolean);

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

        // Nettoyage fichier partiel
        if (fs.existsSync(videoPath)) {
          try { fs.unlinkSync(videoPath); } catch (e) {}
        }
      }
    }

    // Vérification finale du téléchargement
    if (!success || !fs.existsSync(videoPath) || fs.statSync(videoPath).size < 100000) {
      throw new Error(
        hasCookies
          ? "Impossible de télécharger la vidéo. Vos cookies YouTube sont peut-être expirés. Essayez de réexporter cookies.txt."
          : "Impossible de télécharger la vidéo. Essayez d'exporter vos cookies YouTube dans un fichier cookies.txt à la racine du projet."
      );
    }

    // ==================== APPEL GEMINI AVEC RETRY AUTOMATIQUE ====================
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
   // change en gemini-1.5-pro si tu veux plus de qualité

    let result;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Tentative Gemini ${attempt}/${maxAttempts}...`);

        // ←←← Remplace ce prompt par ton vrai prompt détaillé ←←←
        const prompt = `Tu es un expert en création de prompts pour Kling AI / Sora / Veo 3.
Analyse cette vidéo YouTube Shorts et retourne UNIQUEMENT un objet JSON avec les clés suivantes :
{
  "main_prompt": "prompt ultra détaillé et optimisé pour vidéo IA",
  "style": "...",
  "duration": "...",
  "camera_movement": "...",
  ...
}
Vidéo : ${url}`;

        result = await model.generateContent(prompt);
        break; // Succès → sortie de la boucle

      } catch (err: any) {
        lastError = err.message || err.toString();
        console.log(`Tentative Gemini ${attempt} échouée:`, lastError);

        if (attempt === maxAttempts) {
          throw new Error(`Gemini a échoué après ${maxAttempts} tentatives : ${lastError}`);
        }

        // Backoff léger
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (!result) {
      throw new Error("Gemini n'a pas renvoyé de réponse valide");
    }

    // ==================== TRAITEMENT DE LA RÉPONSE GEMINI ====================
    const responseText = result.response.text();
    let analysis;

    try {
      const match = responseText.match(/\{[\s\S]*\}/);
      analysis = match ? JSON.parse(match[0]) : { main_prompt: responseText };
    } catch {
      analysis = { main_prompt: responseText };
    }

    // Nettoyage du fichier vidéo (succès)
    if (fs.existsSync(videoPath)) {
      try { fs.unlinkSync(videoPath); } catch (e) {}
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