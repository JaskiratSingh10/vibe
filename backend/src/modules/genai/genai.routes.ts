import { Router, Request, Response } from 'express';
import { GenaiController } from './genai.controller';
import { validateTranscriptRequest } from './genai.validation';

// Instantiate the controller
const genaiController = new GenaiController();

// Create an Express router instance
const router = Router();

// Define a POST route for generating a full transcript
// The generateTranscript method in GenaiController is an arrow function,
// so it's already correctly bound.
router.post('/generate/transcript', validateTranscriptRequest, genaiController.generateTranscript);

// Define a placeholder for the /generate/transcript/segment route
router.post('/generate/transcript/segment', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not Implemented: Transcript segmentation will be available in a future update.' });
});

// Export the router
export default router;
