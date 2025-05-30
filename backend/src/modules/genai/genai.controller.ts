import { NextFunction, Request, Response } from 'express';
import { GenaiService } from './genai.service';

export class GenaiController {
  private genaiService: GenaiService;

  constructor() {
    this.genaiService = new GenaiService();
  }

  // Binding `this` to ensure `this.genaiService` is accessible
  // when the method is called by Express routing.
  public generateTranscript = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { url } = req.body;
    let videoPath: string | undefined;
    let audioPath: string | undefined;

    if (!url) {
      res.status(400).json({ message: 'Missing URL in request body' });
      return;
    }

    try {
      console.log(`Processing URL: ${url}`);
      videoPath = await this.genaiService.downloadVideo(url);
      console.log(`Video downloaded to: ${videoPath}`);
      audioPath = await this.genaiService.extractAudio(videoPath);
      console.log(`Audio extracted to: ${audioPath}`);
      const transcript = await this.genaiService.transcribeAudio(audioPath);
      console.log('Transcription successful.');

      res.status(200).json({ transcript });
    } catch (error) {
      console.error('Error processing video to transcript:', error);
      // Pass to the global error handler, or send a specific response
      // next(error); 
      // For now, sending a specific response:
      let statusCode = 500;
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';

      if (errorMessage.includes('Invalid YouTube URL')) {
        statusCode = 400;
      } else if (errorMessage.includes('OpenAI API error (status: 401)')) {
        // Authentication issue with OpenAI - this is an internal server configuration problem or OpenAI key issue
        statusCode = 500; // Or 502 if preferred, indicating bad gateway/upstream issue
      } else if (errorMessage.includes('OpenAI API error (status: 429)')) {
        statusCode = 429; // Too Many Requests
      } else if (errorMessage.includes('OpenAI API error')) {
        // Other OpenAI errors (e.g., 500 from their side)
        statusCode = 502; // Bad Gateway, indicating an issue with an upstream service
      } else if (errorMessage.includes('Failed to download') || errorMessage.includes('Failed to extract audio')) {
        // These could be various issues, 500 is a general catch-all
        statusCode = 500;
      }
      
      res.status(statusCode).json({ message: 'Error processing video', error: errorMessage });
    } finally {
      // Cleanup temporary files
      const filesToCleanup = [videoPath, audioPath].filter(Boolean) as string[];
      if (filesToCleanup.length > 0) {
        try {
          console.log(`Cleaning up files: ${filesToCleanup.join(', ')}`);
          await this.genaiService.cleanup(...filesToCleanup);
          console.log('Temporary files cleaned up.');
        } catch (cleanupError) {
          console.error('Error cleaning up temporary files:', cleanupError);
          // Optionally, you might want to log this or handle it in a specific way,
          // but typically you wouldn't send a response to the client for cleanup errors.
        }
      }
    }
  };
}
