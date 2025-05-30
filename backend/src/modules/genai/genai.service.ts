import * as fs from 'fs';
import *s_promise from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import ytdl from 'ytdl-core';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export class GenaiService {
  private openai: OpenAI;

  constructor() {
    // It's good practice to initialize the OpenAI client in the constructor.
    // Ensure OPENAI_API_KEY is set in your environment variables.
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async downloadVideo(url: string): Promise<string> {
    console.log(`Downloading video from URL: ${url}`);
    console.log(`Downloading video from URL: ${url}`);
    let videoPath: string = ''; // Define videoPath here to be accessible in catch if needed
    try {
      if (!ytdl.validateURL(url)) {
        // This check is good, but ytdl itself will also throw an error for invalid URLs.
        // Consider removing this explicit check if ytdl's error is sufficient.
        throw new Error('Invalid YouTube URL provided.');
      }

      const videoId = ytdl.getVideoID(url); // Can throw if URL is invalid
      videoPath = path.join(os.tmpdir(), `${videoId}.mp4`);
      
      const videoStream = ytdl(url, { filter: 'audioandvideo' });
      const fileWriteStream = fs.createWriteStream(videoPath);
      
      // Wrap in a promise to handle stream events
      await new Promise((resolve, reject) => {
        videoStream.pipe(fileWriteStream);
        videoStream.on('end', resolve);
        videoStream.on('error', (err) => {
          // Ensure cleanup of potentially partially written file on stream error
          fs.unlink(videoPath, () => {}); // Best effort cleanup
          reject(err); // Reject with the original error
        });
        fileWriteStream.on('error', (err) => { // Also handle write stream errors
          reject(err);
        });
      });

      console.log(`Video downloaded successfully to: ${videoPath}`);
      return videoPath;
    } catch (error: any) {
      console.error('Error downloading video:', error.message);
      // Propagate a more informative error
      throw new Error(`Failed to download video from ${url}. Reason: ${error.message}`);
    }
  }

  async extractAudio(videoPath: string): Promise<string> {
    console.log(`Extracting audio from video: ${videoPath}`);
    console.log(`Extracting audio from video: ${videoPath}`);
    let audioPath: string = ''; // Define for broader scope if needed for cleanup on error
    try {
      audioPath = path.join(os.tmpdir(), `${path.basename(videoPath, path.extname(videoPath))}.mp3`);

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .output(audioPath)
          .noVideo()
          .audioCodec('libmp3lame') // Ensure this codec is suitable for Whisper
          .on('end', () => {
            console.log(`Audio extracted successfully to: ${audioPath}`);
            resolve(audioPath);
          })
          .on('error', (err) => {
            // Ffmpeg errors can be verbose, log err.stderr for more details if available
            console.error('Error during ffmpeg processing:', err.message);
            // Attempt cleanup of potentially partially created audio file
            fs.unlink(audioPath, () => {}); // Best effort cleanup
            reject(err); // Reject with the original error
          })
          .run();
      });
      return audioPath;
    } catch (error: any) {
      console.error('Error extracting audio:', error.message);
      throw new Error(`Failed to extract audio from ${videoPath}. Reason: ${error.message}`);
    }
  }

  async transcribeAudio(audioPath: string): Promise<string> {
    console.log(`Transcribing audio from: ${audioPath}`);
    console.log(`Transcribing audio from: ${audioPath}`);
    try {
      // Ensure the file exists before attempting to create a read stream
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found at path: ${audioPath}`);
      }

      const transcription = await this.openai.audio.transcriptions.create({
        model: 'whisper-1', // Ensure this model is appropriate
        file: fs.createReadStream(audioPath),
      });
      console.log('Audio transcribed successfully.');
      return transcription.text;
    } catch (error: any) {
      console.error('Error transcribing audio:', error.message);
      if (error instanceof OpenAI.APIError) {
        // Handle OpenAI API specific errors
        const status = error.status || 'unknown';
        const message = error.message || 'An OpenAI API error occurred.';
        // You might want to throw a custom error type here or a more structured error
        throw new Error(`Failed to transcribe audio due to OpenAI API error (status: ${status}): ${message}`);
      }
      // For other types of errors (e.g., file system issues if createReadStream fails)
      throw new Error(`Failed to transcribe audio. Reason: ${error.message}`);
    }
  }

  // It's good practice to add a method to clean up temporary files.
  async cleanup(...filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        await fs_promise.unlink(filePath);
        console.log(`Successfully deleted temporary file: ${filePath}`);
      } catch (error) {
        console.error(`Error deleting temporary file ${filePath}:`, error);
        // Decide if you want to throw an error or just log it
      }
    }
  }
}
