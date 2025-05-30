import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';

// Validation schema for the generateTranscript request
const generateTranscriptSchema = Joi.object({
  url: Joi.string().uri({
    scheme: [
      'http',
      'https',
    ],
    allowRelative: false, // Ensures absolute URLs
  }).required().messages({
    'string.base': 'URL must be a string.',
    'string.empty': 'URL cannot be empty.',
    'string.uri': 'URL must be a valid URI (e.g., http://example.com or https://example.com).',
    'any.required': 'URL is a required field.',
  }),
  // Future fields can be added here, e.g.:
  // language: Joi.string().optional().default('en'),
  // model: Joi.string().valid('whisper-1', 'other-model').optional(),
});

export const validateTranscriptRequest = (req: Request, res: Response, next: NextFunction) => {
  // Validate only req.body. For query or params, create separate validations or extend this.
  const { error, value } = generateTranscriptSchema.validate(req.body, {
    abortEarly: false, // Return all errors, not just the first
    stripUnknown: true, // Remove unknown keys from the validated output
  });

  if (error) {
    const errorDetails = error.details.map(detail => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    }));
    console.warn('Validation error for /generate/transcript:', errorDetails);
    return res.status(400).json({
      message: 'Validation error',
      details: errorDetails,
    });
  }

  // Attach the validated and potentially sanitized value to req.body
  // This is useful if you have default values or transformations in your schema
  req.body = value; 
  next();
};

// Placeholder for segment transcript validation (if needed later)
// export const validateSegmentTranscriptRequest = (req: Request, res: Response, next: NextFunction) => {
//   // Define schema and validate
//   next();
// };
