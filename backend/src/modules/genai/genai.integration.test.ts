import request from 'supertest';
import { application } from '../../index'; // Adjust path to your main Express app export
import { GenaiService } from './genai.service'; // To mock its methods

// Mock the GenaiService
jest.mock('./genai.service');

const mockDownloadVideo = jest.fn();
const mockExtractAudio = jest.fn();
const mockTranscribeAudio = jest.fn();
const mockCleanup = jest.fn();

// @ts-ignore
GenaiService.prototype.downloadVideo = mockDownloadVideo;
// @ts-ignore
GenaiService.prototype.extractAudio = mockExtractAudio;
// @ts-ignore
GenaiService.prototype.transcribeAudio = mockTranscribeAudio;
// @ts-ignore
GenaiService.prototype.cleanup = mockCleanup;


describe('POST /genai/generate/transcript', () => {
  const validUrl = 'https://www.youtube.com/watch?v=validvideo';
  const mockVideoPath = '/tmp/video.mp4';
  const mockAudioPath = '/tmp/audio.mp3';
  const mockTranscript = 'This is a test transcript.';

  beforeEach(() => {
    // Reset mocks before each test
    mockDownloadVideo.mockReset();
    mockExtractAudio.mockReset();
    mockTranscribeAudio.mockReset();
    mockCleanup.mockReset();
  });

  it('should return 200 OK with transcript on successful processing', async () => {
    mockDownloadVideo.mockResolvedValue(mockVideoPath);
    mockExtractAudio.mockResolvedValue(mockAudioPath);
    mockTranscribeAudio.mockResolvedValue(mockTranscript);
    mockCleanup.mockResolvedValue(undefined);

    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({ url: validUrl })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({ transcript: mockTranscript });
    expect(mockDownloadVideo).toHaveBeenCalledWith(validUrl);
    expect(mockExtractAudio).toHaveBeenCalledWith(mockVideoPath);
    expect(mockTranscribeAudio).toHaveBeenCalledWith(mockAudioPath);
    expect(mockCleanup).toHaveBeenCalledWith(mockVideoPath, mockAudioPath);
  });

  it('should return 400 Bad Request if URL is missing', async () => {
    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({})
      .expect('Content-Type', /json/)
      .expect(400);
    
    expect(response.body.message).toBe('Validation error');
    // More specific check for Joi's error detail
    expect(response.body.details[0].message).toContain('"url" is required');
  });

  it('should return 400 Bad Request if URL is invalid', async () => {
    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({ url: 'not-a-valid-url' })
      .expect('Content-Type', /json/)
      .expect(400);

    expect(response.body.message).toBe('Validation error');
    expect(response.body.details[0].message).toContain('URL must be a valid URI');
  });

  it('should return 500 if downloadVideo fails', async () => {
    mockDownloadVideo.mockRejectedValue(new Error('Download failed'));

    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({ url: validUrl })
      .expect('Content-Type', /json/)
      .expect(500); // Or specific code based on controller logic, e.g. 500

    expect(response.body.message).toBe('Error processing video');
    expect(response.body.error).toBe('Download failed');
    expect(mockCleanup).toHaveBeenCalledWith(undefined, undefined); // Paths would be undefined
  });

  it('should return 500 if extractAudio fails', async () => {
    mockDownloadVideo.mockResolvedValue(mockVideoPath);
    mockExtractAudio.mockRejectedValue(new Error('Extraction failed'));

    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({ url: validUrl })
      .expect('Content-Type', /json/)
      .expect(500);

    expect(response.body.message).toBe('Error processing video');
    expect(response.body.error).toBe('Extraction failed');
    expect(mockCleanup).toHaveBeenCalledWith(mockVideoPath, undefined);
  });

  it('should return 500 if transcribeAudio fails', async () => {
    mockDownloadVideo.mockResolvedValue(mockVideoPath);
    mockExtractAudio.mockResolvedValue(mockAudioPath);
    mockTranscribeAudio.mockRejectedValue(new Error('Transcription failed'));

    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({ url: validUrl })
      .expect('Content-Type', /json/)
      .expect(500);

    expect(response.body.message).toBe('Error processing video');
    expect(response.body.error).toBe('Transcription failed');
    expect(mockCleanup).toHaveBeenCalledWith(mockVideoPath, mockAudioPath);
  });
  
  it('should return 429 if transcribeAudio fails with OpenAI rate limit error', async () => {
    mockDownloadVideo.mockResolvedValue(mockVideoPath);
    mockExtractAudio.mockResolvedValue(mockAudioPath);
    // Service throws: new Error(`Failed to transcribe audio due to OpenAI API error (status: 429): Rate limit exceeded`)
    mockTranscribeAudio.mockRejectedValue(new Error('Failed to transcribe audio due to OpenAI API error (status: 429): Rate limit exceeded'));

    const response = await request(application)
      .post('/genai/generate/transcript')
      .send({ url: validUrl })
      .expect('Content-Type', /json/)
      .expect(429);

    expect(response.body.message).toBe('Error processing video');
    expect(response.body.error).toContain('OpenAI API error (status: 429)');
    expect(mockCleanup).toHaveBeenCalledWith(mockVideoPath, mockAudioPath);
  });

  it('should still call cleanup if an error occurs mid-process (e.g. extractAudio fails)', async () => {
    mockDownloadVideo.mockResolvedValue(mockVideoPath);
    mockExtractAudio.mockRejectedValue(new Error('Extraction failed mid-process'));
    // transcribeAudio and cleanup should still be called in some way if paths are defined
    
    await request(application)
      .post('/genai/generate/transcript')
      .send({ url: validUrl })
      .expect(500); // Error response

    expect(mockDownloadVideo).toHaveBeenCalledWith(validUrl);
    expect(mockExtractAudio).toHaveBeenCalledWith(mockVideoPath);
    expect(mockTranscribeAudio).not.toHaveBeenCalled(); // Should not be called
    // videoPath was defined, audioPath was not (or was undefined when error thrown by extractAudio)
    expect(mockCleanup).toHaveBeenCalledWith(mockVideoPath, undefined); 
  });
});
