import { GenaiService } from './genai.service';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import fs from 'fs';
import fs_promise from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable, Writable } from 'stream';

// Mock external dependencies
jest.mock('ytdl-core');
jest.mock('fluent-ffmpeg');
jest.mock('openai');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'), // Import and retain default behavior
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
  unlink: jest.fn((path, cb) => cb()), // Mock unlink for downloadVideo/extractAudio error cleanup
}));
jest.mock('fs/promises', () => ({
  unlink: jest.fn(),
}));
jest.mock('os');

// Mock implementation for ffmpeg
const mockFfmpeg = {
  output: jest.fn().mockReturnThis(),
  noVideo: jest.fn().mockReturnThis(),
  audioCodec: jest.fn().mockReturnThis(),
  on: jest.fn().mockImplementation(function (this: any, event, callback) {
    if (event === 'end') {
      this._endCallback = callback;
    } else if (event === 'error') {
      this._errorCallback = callback;
    }
    return this;
  }),
  run: jest.fn().mockImplementation(function (this: any) {
    if (this._shouldFail && this._errorCallback) {
      this._errorCallback(new Error('ffmpeg error'));
    } else if (this._endCallback) {
      this._endCallback();
    }
  }),
  _shouldFail: false, // Add a flag to control success/failure for tests
  setFailure: function (fail: boolean) {
    this._shouldFail = fail;
  },
  // Reset mocks for ffmpeg related functions
  resetAllMocks: function () {
    this.output.mockClear().mockReturnThis();
    this.noVideo.mockClear().mockReturnThis();
    this.audioCodec.mockClear().mockReturnThis();
    this.on.mockClear().mockReturnThis();
    this.run.mockClear();
    this._shouldFail = false;
  }
};
(ffmpeg as unknown as jest.Mock).mockImplementation(() => mockFfmpeg);


describe('GenaiService', () => {
  let genaiService: GenaiService;
  const mockTmpDir = '/mock/tmp';
  const mockVideoId = 'testVideoId';
  const mockUrl = `https://www.youtube.com/watch?v=${mockVideoId}`;
  const mockVideoPath = path.join(mockTmpDir, `${mockVideoId}.mp4`);
  const mockAudioPath = path.join(mockTmpDir, `${mockVideoId}.mp3`);

  beforeEach(() => {
    jest.clearAllMocks();
    genaiService = new GenaiService();

    // Setup default mock implementations
    (os.tmpdir as jest.Mock).mockReturnValue(mockTmpDir);
    (fs.createWriteStream as jest.Mock).mockReturnValue(new Writable({
      write(chunk, encoding, callback) {
        callback();
      }
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs_promise.unlink as jest.Mock).mockResolvedValue(undefined);

    // Default ytdl mock (success)
    (ytdl.validateURL as jest.Mock).mockReturnValue(true);
    (ytdl.getVideoID as jest.Mock).mockReturnValue(mockVideoId);
    const mockVideoStream = new Readable({ read() {} });
    (ytdl as jest.Mock).mockReturnValue(mockVideoStream);
    
    // Setup mockFfmpeg to succeed by default
    mockFfmpeg.setFailure(false);
    mockFfmpeg.resetAllMocks(); // Important to reset state between tests

    // Default OpenAI mock (success)
    (OpenAI.prototype.audio.transcriptions.create as jest.Mock).mockResolvedValue({
      text: 'Mocked transcript',
    });

    // Simulate stream ending successfully for ytdl
    process.nextTick(() => {
        mockVideoStream.emit('end');
    });
  });

  describe('downloadVideo', () => {
    it('should download a video successfully', async () => {
      const resultPath = await genaiService.downloadVideo(mockUrl);
      expect(ytdl).toHaveBeenCalledWith(mockUrl, { filter: 'audioandvideo' });
      expect(fs.createWriteStream).toHaveBeenCalledWith(mockVideoPath);
      expect(resultPath).toBe(mockVideoPath);
    });

    it('should throw an error if ytdl.validateURL returns false', async () => {
      (ytdl.validateURL as jest.Mock).mockReturnValue(false);
      await expect(genaiService.downloadVideo(mockUrl))
        .rejects
        .toThrow('Invalid YouTube URL provided.');
    });
    
    it('should throw an error if video stream emits an error', async () => {
      const mockError = new Error('YTDL stream error');
      const mockVideoStreamError = new Readable({
        read() {
          this.emit('error', mockError); // Emit error when read is called
        }
      });
      (ytdl as jest.Mock).mockReturnValue(mockVideoStreamError);

      await expect(genaiService.downloadVideo(mockUrl))
        .rejects
        .toThrow(`Failed to download video from ${mockUrl}. Reason: YTDL stream error`);
       expect(fs.unlink).toHaveBeenCalledWith(mockVideoPath, expect.any(Function)); // Check cleanup
    });

    it('should throw an error if createWriteStream fails', async () => {
        const mockError = new Error('WriteStream error');
        (fs.createWriteStream as jest.Mock).mockImplementation(() => {
            throw mockError;
        });
        await expect(genaiService.downloadVideo(mockUrl))
            .rejects
            .toThrow(`Failed to download video from ${mockUrl}. Reason: WriteStream error`);
    });
  });

  describe('extractAudio', () => {
    it('should extract audio successfully', async () => {
      const resultPath = await genaiService.extractAudio(mockVideoPath);
      expect(ffmpeg).toHaveBeenCalledWith(mockVideoPath);
      expect(mockFfmpeg.output).toHaveBeenCalledWith(mockAudioPath);
      expect(mockFfmpeg.noVideo).toHaveBeenCalled();
      expect(mockFfmpeg.audioCodec).toHaveBeenCalledWith('libmp3lame');
      expect(mockFfmpeg.run).toHaveBeenCalled();
      expect(resultPath).toBe(mockAudioPath);
    });

    it('should throw an error if ffmpeg processing fails', async () => {
      mockFfmpeg.setFailure(true); // Configure mockFfmpeg to simulate an error
      await expect(genaiService.extractAudio(mockVideoPath))
        .rejects
        .toThrow(`Failed to extract audio from ${mockVideoPath}. Reason: ffmpeg error`);
      expect(fs.unlink).toHaveBeenCalledWith(mockAudioPath, expect.any(Function)); // Check cleanup
    });
  });

  describe('transcribeAudio', () => {
    it('should transcribe audio successfully', async () => {
      const transcript = await genaiService.transcribeAudio(mockAudioPath);
      expect(OpenAI.prototype.audio.transcriptions.create).toHaveBeenCalledWith({
        model: 'whisper-1',
        file: expect.any(Readable), // fs.createReadStream returns a Readable stream
      });
      expect(transcript).toBe('Mocked transcript');
    });

    it('should throw an error if audio file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      await expect(genaiService.transcribeAudio(mockAudioPath))
        .rejects
        .toThrow(`Failed to transcribe audio. Reason: Audio file not found at path: ${mockAudioPath}`);
    });

    it('should throw an OpenAI APIError if transcription fails', async () => {
      const apiError = new OpenAI.APIError(401, { error: { message: 'Auth error' } }, 'Error', {});
      (OpenAI.prototype.audio.transcriptions.create as jest.Mock).mockRejectedValue(apiError);
      
      await expect(genaiService.transcribeAudio(mockAudioPath))
        .rejects
        .toThrow('Failed to transcribe audio due to OpenAI API error (status: 401): Auth error');
    });

     it('should throw a generic error for non-API errors during transcription', async () => {
      const genericError = new Error('Some other error');
      (OpenAI.prototype.audio.transcriptions.create as jest.Mock).mockRejectedValue(genericError);
      
      await expect(genaiService.transcribeAudio(mockAudioPath))
        .rejects
        .toThrow('Failed to transcribe audio. Reason: Some other error');
    });
  });

  describe('cleanup', () => {
    it('should attempt to delete all specified files', async () => {
      const files = ['/mock/tmp/file1.mp4', '/mock/tmp/file2.mp3'];
      await genaiService.cleanup(...files);
      expect(fs_promise.unlink).toHaveBeenCalledTimes(2);
      expect(fs_promise.unlink).toHaveBeenCalledWith(files[0]);
      expect(fs_promise.unlink).toHaveBeenCalledWith(files[1]);
    });

    it('should log errors but not throw if unlink fails for a file', async () => {
      const files = ['/mock/tmp/file1.mp4', '/mock/tmp/file2.mp3'];
      (fs_promise.unlink as jest.Mock)
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error('Deletion failed')); // Second call fails

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      await expect(genaiService.cleanup(...files)).resolves.toBeUndefined(); // Should not throw overall
      expect(fs_promise.unlink).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error deleting temporary file ${files[1]}:`,
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
